import Subset from './Subset';
import Directory from '../tables/directory';
import TTFGlyphEncoder from '../glyph/TTFGlyphEncoder';

export default class TTFSubset extends Subset {
  constructor(font) {
    super(font);
    this.glyphEncoder = new TTFGlyphEncoder();
  }

  _addGlyph(gid) {
    let glyph = this.font.getGlyph(gid);
    let glyf = glyph._decode();

    // get the offset to the glyph from the loca table
    let curOffset = this.font.loca.offsets[gid];
    let nextOffset = this.font.loca.offsets[gid + 1];

    let stream = this.font._getTableStream('glyf');
    stream.pos += curOffset;

    let buffer = stream.readBuffer(nextOffset - curOffset);

    let bearing = glyph._getMetrics().leftBearing;
    if (glyf && this.font._variationProcessor) {
      // If this is a TrueType variation glyph, re-encode the path and take the
      // left side bearing from it. Compound glyphs are flattened too, as the
      // offsets of their components vary.
      buffer = this.glyphEncoder.encodeSimple(glyph.path, glyf.instructions);
      bearing = glyph.path.cbox.minX;
    } else if (glyf && glyf.numberOfContours < 0) {
      // if it is a compound glyph, include its components
      buffer = new Uint8Array(buffer);
      let view = new DataView(buffer.buffer);
      for (let component of glyf.components) {
        gid = this.includeGlyph(component.glyphID);
        view.setUint16(component.pos, gid);
      }
    }

    this.glyf.push(buffer);
    this.loca.offsets.push(this.offset);

    this.hmtx.metrics.push({
      // varied advances interpolate to floats; hmtx stores whole units
      advance: Math.round(glyph.advanceWidth),
      bearing,
    });

    this.offset += buffer.length;
    return this.glyf.length - 1;
  }

  // A post table without glyph names, so the subset stands alone:
  // font-wide metrics such as the underline position read from it.
  // Values come from the font's metrics, with any MVAR variation
  // adjustments already applied.
  _postTable() {
    let { post } = this.font;
    let metrics = post ? this.font._getMetrics() : null;

    return {
      version: 3,
      italicAngle: post ? post.italicAngle : 0,
      underlinePosition: metrics ? Math.round(metrics.underlinePosition) : 0,
      underlineThickness: metrics ? Math.round(metrics.underlineThickness) : 0,
      isFixedPitch: post ? post.isFixedPitch : 0,
      minMemType42: 0,
      maxMemType42: 0,
      minMemType1: 0,
      maxMemType1: 0,
    };
  }

  // A cmap mapping the subset's characters to their new glyph ids.
  _cmapTable() {
    let pairs = Object.keys(this.cmap)
      .map((codePoint) => [Number(codePoint), this.cmap[codePoint]])
      .sort((a, b) => a[0] - b[0]);

    // Merge runs of consecutive code points mapped to consecutive glyphs.
    let segments = [];
    for (let [codePoint, gid] of pairs) {
      let last = segments[segments.length - 1];
      if (last && codePoint === last.end + 1 && gid === last.lastGid + 1) {
        last.end = codePoint;
        last.lastGid = gid;
      } else {
        segments.push({
          start: codePoint,
          end: codePoint,
          startGid: gid,
          lastGid: gid,
        });
      }
    }

    // Format 12 covers code points beyond the basic multilingual plane.
    if (pairs.length > 0 && pairs[pairs.length - 1][0] > 0xffff) {
      return {
        version: 0,
        numSubtables: 1,
        tables: [
          {
            platformID: 3,
            encodingID: 10,
            table: {
              version: 12,
              length: 16 + 12 * segments.length,
              language: 0,
              nGroups: segments.length,
              groups: segments.map((segment) => ({
                startCharCode: segment.start,
                endCharCode: segment.end,
                glyphID: segment.startGid,
              })),
            },
          },
        ],
      };
    }

    // Format 4 ends with a required segment mapping 0xffff to glyph 0.
    segments.push({ start: 0xffff, end: 0xffff, startGid: 0 });

    let segCount = segments.length;
    let maxPowerOf2 = Math.pow(2, Math.floor(Math.log2(segCount)));

    let endCode = [];
    let startCode = [];
    let idDelta = [];
    let idRangeOffset = [];
    for (let segment of segments) {
      endCode.push(segment.end);
      startCode.push(segment.start);

      // (codePoint + delta) must give the glyph id, modulo 65536.
      let delta = (segment.startGid - segment.start) & 0xffff;
      if (delta >= 0x8000) {
        delta -= 0x10000;
      }

      idDelta.push(delta);
      idRangeOffset.push(0);
    }

    return {
      version: 0,
      numSubtables: 1,
      tables: [
        {
          platformID: 3,
          encodingID: 1,
          table: {
            version: 4,
            length: 16 + 8 * segCount,
            language: 0,
            segCountX2: segCount * 2,
            searchRange: maxPowerOf2 * 2,
            entrySelector: Math.log2(maxPowerOf2),
            rangeShift: segCount * 2 - maxPowerOf2 * 2,
            endCode,
            startCode,
            idDelta,
            idRangeOffset,
            glyphIndexArray: [],
          },
        },
      ],
    };
  }

  encode() {
    // tables required by PDF spec:
    //   head, hhea, loca, maxp, cvt , prep, glyf, hmtx, fpgm
    //
    // additional tables required for standalone fonts:
    //   name, cmap, OS/2, post

    this.glyf = [];
    this.offset = 0;
    this.loca = {
      offsets: [],
      version: this.font.loca.version,
    };

    this.hmtx = {
      metrics: [],
      bearings: [],
    };

    // include all the glyphs
    // not using a for loop because we need to support adding more
    // glyphs to the array as we go, and CoffeeScript caches the length.
    let i = 0;
    while (i < this.glyphs.length) {
      this._addGlyph(this.glyphs[i++]);
    }

    let maxp = { ...this.font.maxp };
    maxp.numGlyphs = this.glyf.length;

    this.loca.offsets.push(this.offset);

    let head = { ...this.font.head };
    head.indexToLocFormat = this.loca.version;

    let hhea = { ...this.font.hhea };
    hhea.numberOfMetrics = this.hmtx.metrics.length;

    if (this.font._variationProcessor) {
      // Bake the varied global metrics into the subset, so it works as a
      // static instance without the variation tables.
      let metrics = this.font._getMetrics();
      hhea.ascent = Math.round(metrics.ascent);
      hhea.descent = Math.round(metrics.descent);
      hhea.lineGap = Math.round(metrics.lineGap);
    }

    // TODO: subset prep, cvt, fpgm?
    return Directory.toBuffer({
      tables: {
        head,
        hhea,
        loca: this.loca,
        maxp,
        'cvt ': this.font['cvt '],
        prep: this.font.prep,
        glyf: this.glyf,
        hmtx: this.hmtx,
        fpgm: this.font.fpgm,
        cmap: this._cmapTable(),
        post: this._postTable(),

        // name: clone @font.name
        // 'OS/2': clone @font['OS/2']
      },
    });
  }
}

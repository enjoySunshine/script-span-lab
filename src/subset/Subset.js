import * as r from 'restructure';

const resolved = Promise.resolve();

export default class Subset {
  constructor(font) {
    this.font = font;
    this.glyphs = [];
    this.mapping = {};
    this.cmap = {}; // code point -> glyph id in the subset

    // always include the missing glyph
    this.includeGlyph(0);
  }

  includeGlyph(glyph) {
    let codePoints = null;
    if (typeof glyph === 'object') {
      codePoints = glyph.codePoints;
      glyph = glyph.id;
    }

    if (this.mapping[glyph] == null) {
      this.glyphs.push(glyph);
      this.mapping[glyph] = this.glyphs.length - 1;
    }

    let id = this.mapping[glyph];

    // Only glyphs reached by a single code point get a cmap entry in the
    // subset. Ligatures and variation sequences map from several code
    // points and have no single-codepoint mapping.
    if (codePoints && codePoints.length === 1) {
      this.cmap[codePoints[0]] = id;
    }

    return id;
  }
}

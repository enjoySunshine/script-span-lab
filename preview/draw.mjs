import fs from "node:fs";
import * as fontkit from "../dist/node/index.js";

// Title preview: the letter A from Playwrite at one named variation
// instance, read back from a freshly encoded subset — the same small font
// the title ships. Run `npm run build` first. Pass another instance name to
// preview it, or "default" for the font with no axes applied:
//   node preview/draw.mjs Italic
//   node preview/draw.mjs default
const instanceName = process.argv[2] ?? "Maximum";

const source = fontkit.openSync(
  new URL("../test/data/Playwrite/Playwrite-MM-Subset.ttf", import.meta.url),
);
const instance =
  instanceName === "default" ? source : source.getVariation(instanceName);

const subset = instance.createSubset();
subset.includeGlyph(instance.glyphForCodePoint(0x41)); // A

// The font the title actually renders from.
const font = fontkit.create(subset.encode());
const glyph = font.glyphForCodePoint(0x41);

const advance = glyph.advanceWidth;
const d = glyph.path.toSVG();
const { ascent, descent } = font;
const height = ascent - descent;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-ascent} ${advance} ${height}" width="480" height="${Math.ceil((480 * height) / advance)}">
  <rect x="0" y="${-ascent}" width="${advance}" height="${height}" fill="#111"/>
  <g transform="scale(1,-1)">
    <path d="${d}" fill="#f4f1ea"/>
    <line x1="0" y1="0" x2="${advance}" y2="0" stroke="#3a5" stroke-width="6"/>
    <line x1="${advance}" y1="${descent}" x2="${advance}" y2="${ascent}" stroke="#e54" stroke-width="6"/>
  </g>
</svg>
`;
fs.writeFileSync(new URL("./out.svg", import.meta.url), svg);
console.log(
  `instance=${instanceName} advance=${advance} path=${d.length} chars, starts "${d.split("Q")[0]}"`,
);
console.log("wrote preview/out.svg", advance, height);

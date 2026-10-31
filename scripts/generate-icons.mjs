/**
 * Generates the PWA / home-screen icons from the brand glyph (lucide "hand-coins").
 * Run: node scripts/generate-icons.mjs   (uses sharp, which ships with Next.js)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BLUE = "#2a78d6";
const GLYPH = `
  <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"/>
  <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/>
  <path d="m2 16 6 6"/>
  <circle cx="16" cy="9" r="2.9"/>
  <circle cx="6" cy="5" r="3"/>`;

/**
 * @param size     output px
 * @param glyph    glyph size as a fraction of the canvas
 * @param rounded  rounded-square tile with transparent corners ("any" icons);
 *                 false = full-bleed square (maskable / Apple, which apply their own mask)
 */
function svg(size, glyph, rounded) {
  const g = size * glyph;
  const offset = (size - g) / 2;
  const radius = rounded ? size * 0.22 : 0;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BLUE}"/>
  <g transform="translate(${offset} ${offset}) scale(${g / 24})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g>
</svg>`);
}

const outputs = [
  ["public/icons/icon-192.png", 192, 0.6, true],
  ["public/icons/icon-512.png", 512, 0.6, true],
  // Maskable: glyph kept inside the central 80% safe zone.
  ["public/icons/maskable-192.png", 192, 0.5, false],
  ["public/icons/maskable-512.png", 512, 0.5, false],
  ["public/icons/shortcut-expense.png", 96, 0.6, true],
  // Next.js metadata files: <link rel="icon"> and <link rel="apple-touch-icon">.
  ["src/app/icon.png", 64, 0.62, true],
  ["src/app/apple-icon.png", 180, 0.56, false],
];

mkdirSync("public/icons", { recursive: true });
for (const [file, size, glyph, rounded] of outputs) {
  await sharp(svg(size, glyph, rounded)).png({ compressionLevel: 9 }).toFile(file);
  console.log("wrote", file);
}

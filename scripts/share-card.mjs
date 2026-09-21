import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_TOKENS_FILE = resolve(ROOT, "assets", "brand", "brand-tokens.json");
const BRAND_TEMPLATE_FILE = resolve(ROOT, "assets", "brand", "sbns-social-og.svg");
const SERIF_FONT_FILE = resolve(
  process.env.SBNS_SHARE_CARD_SERIF_FONT ||
    resolve(ROOT, "assets", "fonts", "eb-garamond-variable.ttf"),
);
const SANS_FONT_FILE = resolve(
  process.env.SBNS_SHARE_CARD_SANS_FONT ||
    resolve(ROOT, "assets", "fonts", "inter-variable.ttf"),
);

const brandTokens = JSON.parse(readFileSync(BRAND_TOKENS_FILE, "utf8"));
const canonicalTemplate = readFileSync(BRAND_TEMPLATE_FILE, "utf8");

export const BRAND_COLORS = Object.freeze({
  inkBlack: brandTokens.colors.ink_black,
  newsprintGray: brandTokens.colors.newsprint_gray,
  slate: brandTokens.colors.slate,
  paperWhite: brandTokens.colors.paper_white,
  signalRed: brandTokens.colors.signal_red,
  ruleGray: brandTokens.colors.rule_gray,
  white: brandTokens.colors.white,
});

export const BRAND_TYPOGRAPHY = Object.freeze({
  serif: brandTokens.typography.display_serif,
  sans: brandTokens.typography.ui_sans,
});

const SITE_ORIGIN = "https://shockedbutnotsurprised.news";
const HEADLINE_X = 78;
const HEADLINE_TOP = 270;
const HEADLINE_BOTTOM = 515;
const HEADLINE_MAX_WIDTH = 1044;
const HEADLINE_MAX_LINES = 4;
const HEADLINE_MAX_CHARACTERS = 240;
const HEADLINE_FONT_SIZES = [54, 51, 48, 45, 42, 39];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const measurementCache = new Map();

function requireBrandInputs() {
  const requiredColors = [
    "inkBlack",
    "newsprintGray",
    "slate",
    "paperWhite",
    "signalRed",
    "ruleGray",
    "white",
  ];
  for (const key of requiredColors) {
    if (!/^#[0-9A-F]{6}$/u.test(BRAND_COLORS[key])) {
      throw new Error(`Canonical brand token ${key} is missing or invalid`);
    }
  }
  if (!BRAND_TYPOGRAPHY.serif || !BRAND_TYPOGRAPHY.sans) {
    throw new Error("Canonical brand typography tokens are missing");
  }
  if (
    !canonicalTemplate.includes(`width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`) ||
    !canonicalTemplate.includes(BRAND_COLORS.inkBlack) ||
    !canonicalTemplate.includes(BRAND_COLORS.signalRed) ||
    !canonicalTemplate.includes("Shocked But Not Surprised") ||
    !canonicalTemplate.includes("INDEPENDENT ACCOUNTABILITY REPORTING")
  ) {
    throw new Error("Canonical social template does not satisfy the SBNS share-card contract");
  }
}

function canonicalHeader() {
  const dividerPattern =
    /<line x1="70" y1="190" x2="1130" y2="190" stroke="[^"]+" stroke-width="2"\/>/u;
  const divider = dividerPattern.exec(canonicalTemplate);
  if (!divider) throw new Error("Canonical social template divider was not found");
  return `${canonicalTemplate.slice(0, divider.index)}<line x1="70" y1="190" x2="1130" y2="190" stroke="${BRAND_COLORS.newsprintGray}" stroke-width="2"/>`;
}

requireBrandInputs();
const CANONICAL_HEADER = canonicalHeader();

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function rendererOptions() {
  return {
    font: {
      fontFiles: [SERIF_FONT_FILE, SANS_FONT_FILE],
      loadSystemFonts: false,
      defaultFontFamily: BRAND_TYPOGRAPHY.serif,
      serifFamily: BRAND_TYPOGRAPHY.serif,
      sansSerifFamily: BRAND_TYPOGRAPHY.sans,
    },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
    logLevel: "off",
  };
}

function measureText(value, fontSize) {
  const cacheKey = `${fontSize}\u0000${value}`;
  if (measurementCache.has(cacheKey)) return measurementCache.get(cacheKey);
  const baseline = Math.ceil(fontSize * 1.35);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="256">
  <text x="0" y="${baseline}" fill="#fff" font-family="${BRAND_TYPOGRAPHY.serif}" font-size="${fontSize}" font-weight="700">${escapeXml(value)}</text>
</svg>`;
  const box = new Resvg(svg, rendererOptions()).innerBBox();
  if (!box) throw new Error("Unable to measure share-card text with the bundled canonical font");
  measurementCache.set(cacheKey, box.width);
  return box.width;
}

function wrapAtSize(headline, fontSize) {
  const words = headline.trim().split(/\s+/u);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (measureText(word, fontSize) > HEADLINE_MAX_WIDTH) return null;
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, fontSize) <= HEADLINE_MAX_WIDTH) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0 || lines.length > HEADLINE_MAX_LINES) return null;

  const lineHeight = Math.ceil(fontSize * 1.1);
  const finalTextBottom =
    HEADLINE_TOP + fontSize + (lines.length - 1) * lineHeight + Math.ceil(fontSize * 0.22);
  if (finalTextBottom > HEADLINE_BOTTOM) return null;

  const lineWidths = lines.map((line) => measureText(line, fontSize));
  if (lineWidths.some((width) => width > HEADLINE_MAX_WIDTH)) return null;
  return {
    fontSize,
    lineHeight,
    lines,
    lineWidths,
    maxWidth: HEADLINE_MAX_WIDTH,
    top: HEADLINE_TOP,
    bottom: finalTextBottom,
  };
}

export function layoutHeadline(headline) {
  if (typeof headline !== "string" || !headline.trim()) {
    throw new Error("Share-card headline must be a non-empty string");
  }
  if ([...headline].length > HEADLINE_MAX_CHARACTERS) {
    throw new Error(
      `Unable to fit share-card headline: exceeds ${HEADLINE_MAX_CHARACTERS} characters`,
    );
  }
  for (const fontSize of HEADLINE_FONT_SIZES) {
    const layout = wrapAtSize(headline, fontSize);
    if (layout) return layout;
  }
  throw new Error(
    `Unable to fit share-card headline within ${HEADLINE_MAX_LINES} lines at the minimum supported size`,
  );
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function renderSeverity(severity) {
  const bars = Array.from({ length: 5 }, (_, index) => {
    const x = 232 + index * 42;
    const fill = index < severity ? BRAND_COLORS.paperWhite : "none";
    return `    <rect x="${x}" y="572" width="28" height="8" rx="4" fill="${fill}" stroke="${BRAND_COLORS.ruleGray}" stroke-width="2" />`;
  }).join("\n");
  return `  <g data-role="severity">
    <text x="78" y="581" fill="${BRAND_COLORS.paperWhite}" font-family="${BRAND_TYPOGRAPHY.sans}" font-size="15" font-weight="600" letter-spacing="2">SEVERITY ${severity} / 5</text>
${bars}
  </g>`;
}

function renderHeadline(layout) {
  return layout.lines
    .map((line, index) => {
      const y = HEADLINE_TOP + layout.fontSize + index * layout.lineHeight;
      return `  <text x="${HEADLINE_X}" y="${y}" fill="${BRAND_COLORS.paperWhite}" font-family="${BRAND_TYPOGRAPHY.serif}" font-size="${layout.fontSize}" font-weight="700">${escapeXml(line)}</text>`;
    })
    .join("\n");
}

export function canonicalShareCardUrl(storyId) {
  return `${SITE_ORIGIN}/share/${storyId}.png`;
}

export function shareCardAlt(story) {
  return `SBNS branded share card for “${story.headline}”`;
}

export function generateShareCard(story) {
  const layout = layoutHeadline(story.headline);
  const svg = `${CANONICAL_HEADER}
  <line x1="78" y1="226" x2="106" y2="226" stroke="${BRAND_COLORS.signalRed}" stroke-width="6" />
  <text x="120" y="233" fill="${BRAND_COLORS.paperWhite}" font-family="${BRAND_TYPOGRAPHY.sans}" font-size="15" font-weight="600" letter-spacing="2.4">${escapeXml(story.category.toUpperCase())}</text>
  <text x="1122" y="233" fill="${BRAND_COLORS.slate}" font-family="${BRAND_TYPOGRAPHY.sans}" font-size="15" font-weight="600" text-anchor="end" letter-spacing="1.4">${escapeXml(formatDate(story.published_at).toUpperCase())}</text>
${renderHeadline(layout)}
  <line x1="78" y1="538" x2="1122" y2="538" stroke="${BRAND_COLORS.newsprintGray}" stroke-width="2" />
${renderSeverity(story.severity)}
  <text x="1122" y="583" fill="${BRAND_COLORS.paperWhite}" font-family="${BRAND_TYPOGRAPHY.sans}" font-size="18" font-weight="600" text-anchor="end">ShockedButNotSurprised<tspan fill="${BRAND_COLORS.signalRed}">.news</tspan></text>
</svg>`;
  if (svg.includes("<image") || /https?:\/\//u.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', ""))) {
    throw new Error("Share-card SVG must not contain external image references");
  }
  const rendered = new Resvg(svg, rendererOptions()).render();
  if (rendered.width !== CARD_WIDTH || rendered.height !== CARD_HEIGHT) {
    throw new Error(
      `Share-card renderer returned ${rendered.width}x${rendered.height}; expected ${CARD_WIDTH}x${CARD_HEIGHT}`,
    );
  }
  const png = rendered.asPng();
  validatePng(png);
  return { png, svg, layout };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validatePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Generated share card is not a valid PNG file");
  }

  let offset = 8;
  let ihdr;
  let sawIend = false;
  const idat = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error("PNG contains a truncated chunk");
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > buffer.length) throw new Error("PNG chunk exceeds file length");
    const type = buffer.toString("ascii", typeStart, dataStart);
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = crc32(buffer.subarray(typeStart, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error(`PNG ${type} chunk failed CRC validation`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    offset = crcOffset + 4;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!ihdr || ihdr.length !== 13 || !sawIend || offset !== buffer.length || idat.length === 0) {
    throw new Error("PNG is missing required IHDR, IDAT, or IEND structure");
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filter = ihdr[11];
  const interlace = ihdr[12];
  if (
    width !== CARD_WIDTH ||
    height !== CARD_HEIGHT ||
    bitDepth !== 8 ||
    colorType !== 6 ||
    compression !== 0 ||
    filter !== 0 ||
    interlace !== 0
  ) {
    throw new Error(
      `PNG contract mismatch: ${width}x${height}, depth ${bitDepth}, color ${colorType}, interlace ${interlace}`,
    );
  }

  const pixels = inflateSync(Buffer.concat(idat));
  const expectedLength = height * (1 + width * 4);
  if (pixels.length !== expectedLength) throw new Error("PNG pixel stream has an unexpected length");
  for (let row = 0; row < height; row += 1) {
    const filterType = pixels[row * (1 + width * 4)];
    if (filterType > 4) throw new Error(`PNG row ${row} has an invalid filter type`);
  }
  return { width, height, bitDepth, colorType, format: "png" };
}

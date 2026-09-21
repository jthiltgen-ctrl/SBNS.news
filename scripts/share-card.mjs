import { Resvg } from "@resvg/resvg-js";
import { inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_FILE = resolve(
  process.env.SBNS_SHARE_CARD_FONT ||
    resolve(ROOT, "assets", "fonts", "barlow-condensed-latin-700-normal.ttf"),
);
const FONT_FAMILY = "Barlow Condensed";
const SITE_ORIGIN = "https://shockedbutnotsurprised.news";
const HEADLINE_X = 72;
const HEADLINE_TOP = 250;
const HEADLINE_BOTTOM = 512;
const HEADLINE_MAX_WIDTH = 1056;
const HEADLINE_MAX_LINES = 4;
const HEADLINE_MAX_CHARACTERS = 240;
const HEADLINE_FONT_SIZES = [64, 60, 56, 52, 48, 44];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const COLORS = {
  navy: "#101827",
  navyDark: "#0a101b",
  paper: "#f5f0e6",
  gold: "#c6a15b",
  muted: "#aab2c0",
};

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
      fontFiles: [FONT_FILE],
      loadSystemFonts: false,
      defaultFontFamily: FONT_FAMILY,
      sansSerifFamily: FONT_FAMILY,
    },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
    logLevel: "off",
  };
}

function measureText(value, fontSize) {
  const baseline = Math.ceil(fontSize * 1.25);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="256">
  <text x="0" y="${baseline}" fill="#fff" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="700">${escapeXml(value)}</text>
</svg>`;
  const box = new Resvg(svg, rendererOptions()).innerBBox();
  if (!box) throw new Error("Unable to measure share-card text with the bundled font");
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

  const lineHeight = Math.ceil(fontSize * 1.08);
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
  return Array.from({ length: 5 }, (_, index) => {
    const x = 250 + index * 48;
    const fill = index < severity ? COLORS.gold : "none";
    const stroke = index < severity ? COLORS.gold : COLORS.muted;
    return `  <rect x="${x}" y="571" width="34" height="9" rx="4.5" fill="${fill}" stroke="${stroke}" stroke-width="2" />`;
  }).join("\n");
}

function renderHeadline(layout) {
  return layout.lines
    .map((line, index) => {
      const y = HEADLINE_TOP + layout.fontSize + index * layout.lineHeight;
      return `  <text x="${HEADLINE_X}" y="${y}" fill="${COLORS.paper}" font-family="${FONT_FAMILY}" font-size="${layout.fontSize}" font-weight="700">${escapeXml(line)}</text>`;
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${COLORS.navy}" />
  <path d="M0 88H1200 M0 206H1200 M0 540H1200" stroke="${COLORS.paper}" stroke-opacity="0.07" />
  <path d="M246 0V630 M954 0V630" stroke="${COLORS.paper}" stroke-opacity="0.035" />
  <rect width="14" height="${CARD_HEIGHT}" fill="${COLORS.gold}" />
  <rect x="72" y="54" width="76" height="6" fill="${COLORS.gold}" />
  <text x="72" y="91" fill="${COLORS.gold}" font-family="${FONT_FAMILY}" font-size="21" font-weight="700" letter-spacing="4">THE INSTITUTIONAL FAILURE DESK</text>
  <text x="72" y="166" fill="${COLORS.paper}" font-family="${FONT_FAMILY}" font-size="68" font-weight="700" letter-spacing="1">SHOCKED BUT NOT SURPRISED</text>
  <text x="1128" y="82" fill="${COLORS.paper}" font-family="${FONT_FAMILY}" font-size="28" font-weight="700" text-anchor="end" letter-spacing="2">${escapeXml(story.category.toUpperCase())}</text>
  <text x="1128" y="116" fill="${COLORS.muted}" font-family="${FONT_FAMILY}" font-size="20" font-weight="700" text-anchor="end" letter-spacing="1.5">${escapeXml(formatDate(story.published_at).toUpperCase())}</text>
  <line x1="72" y1="206" x2="1128" y2="206" stroke="${COLORS.gold}" stroke-width="2" />
${renderHeadline(layout)}
  <rect x="0" y="540" width="1200" height="90" fill="${COLORS.navyDark}" />
  <text x="72" y="581" fill="${COLORS.muted}" font-family="${FONT_FAMILY}" font-size="20" font-weight="700" letter-spacing="2">SEVERITY ${story.severity} / 5</text>
${renderSeverity(story.severity)}
  <text x="1128" y="585" fill="${COLORS.gold}" font-family="${FONT_FAMILY}" font-size="27" font-weight="700" text-anchor="end" letter-spacing="1.2">SHOCKEDBUTNOTSURPRISED.NEWS</text>
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

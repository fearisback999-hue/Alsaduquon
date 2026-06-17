import sharp from "sharp";

interface TextOverlayOptions {
  text: string;
  backgroundBuffer: Buffer;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "center" | "bottom";
  paddingPercent?: number;
  maxWidthPercent?: number;
  lineSpacing?: number;
}

interface TextRenderResult {
  buffer: Buffer;
  width: number;
  height: number;
  textRendered: boolean;
}

const FONT_STACKS: Record<string, string> = {
  bold_modern: "'Arial Black', 'Helvetica Neue', sans-serif",
  retro: "'Georgia', 'Times New Roman', serif",
  minimalist: "'Helvetica', 'Arial', sans-serif",
  hand_drawn: "'Comic Sans MS', 'Marker Felt', cursive",
  geometric: "'Futura', 'Trebuchet MS', sans-serif",
  boho: "'Palatino', 'Book Antiqua', serif",
  default: "'Arial', 'Helvetica', sans-serif",
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxCharsPerLine && currentLine.length > 0) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += (currentLine ? " " : "") + word;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines;
}

function buildSvgOverlay(opts: {
  text: string;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  strokeColor?: string;
  strokeWidth: number;
  textAlign: string;
  verticalAlign: string;
  paddingPercent: number;
  maxWidthPercent: number;
  lineSpacing: number;
}): Buffer {
  const padding = Math.round(opts.width * (opts.paddingPercent / 100));
  const maxWidth = Math.round(opts.width * (opts.maxWidthPercent / 100));
  const charsPerLine = Math.max(10, Math.floor(maxWidth / (opts.fontSize * 0.55)));

  const lines = wrapText(opts.text, charsPerLine);
  const lineHeight = opts.fontSize * opts.lineSpacing;
  const totalTextHeight = lines.length * lineHeight;

  let anchorX: number;
  let textAnchor: string;
  if (opts.textAlign === "left") {
    anchorX = padding;
    textAnchor = "start";
  } else if (opts.textAlign === "right") {
    anchorX = opts.width - padding;
    textAnchor = "end";
  } else {
    anchorX = opts.width / 2;
    textAnchor = "middle";
  }

  let startY: number;
  if (opts.verticalAlign === "top") {
    startY = padding + opts.fontSize;
  } else if (opts.verticalAlign === "bottom") {
    startY = opts.height - padding - totalTextHeight + opts.fontSize;
  } else {
    startY = (opts.height - totalTextHeight) / 2 + opts.fontSize;
  }

  const strokeAttr = opts.strokeColor
    ? `stroke="${escapeXml(opts.strokeColor)}" stroke-width="${opts.strokeWidth}" paint-order="stroke fill"`
    : "";

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${anchorX}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}">
  <text
    x="${anchorX}"
    y="${Math.round(startY)}"
    font-family="${escapeXml(opts.fontFamily)}"
    font-size="${opts.fontSize}"
    font-weight="${opts.fontWeight}"
    fill="${escapeXml(opts.color)}"
    text-anchor="${textAnchor}"
    ${strokeAttr}
  >${tspans}</text>
</svg>`;

  return Buffer.from(svg);
}

/**
 * Renders text programmatically on top of an AI-generated background image.
 * Uses Sharp's SVG composite to overlay clean, readable typography that
 * DALL-E 3 cannot reliably produce.
 */
export async function renderTextOnBackground(options: TextOverlayOptions): Promise<TextRenderResult> {
  const {
    text,
    backgroundBuffer,
    fontFamily,
    fontSize,
    fontWeight = "bold",
    color = "#FFFFFF",
    strokeColor = "#000000",
    strokeWidth = 2,
    textAlign = "center",
    verticalAlign = "center",
    paddingPercent = 8,
    maxWidthPercent = 85,
    lineSpacing = 1.3,
  } = options;

  const metadata = await sharp(backgroundBuffer).metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;

  const resolvedFontFamily = FONT_STACKS[fontFamily ?? "default"] ?? FONT_STACKS.default;
  const resolvedFontSize = fontSize ?? Math.round(width * 0.08);

  const svgBuffer = buildSvgOverlay({
    text,
    width,
    height,
    fontFamily: resolvedFontFamily,
    fontSize: resolvedFontSize,
    fontWeight,
    color,
    strokeColor,
    strokeWidth,
    textAlign,
    verticalAlign,
    paddingPercent,
    maxWidthPercent,
    lineSpacing,
  });

  const result = await sharp(backgroundBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    textRendered: true,
  };
}

/**
 * Determines optimal text color based on background image brightness.
 * Samples the center region and returns white or dark text.
 */
export async function pickTextColor(backgroundBuffer: Buffer): Promise<{
  textColor: string;
  strokeColor: string;
}> {
  const { data, info } = await sharp(backgroundBuffer)
    .resize(50, 50, { fit: "cover" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let totalBrightness = 0;
  const pixels = info.width * info.height;

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    totalBrightness += 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const avgBrightness = totalBrightness / pixels;

  if (avgBrightness > 160) {
    return { textColor: "#1A1A1A", strokeColor: "#FFFFFF" };
  } else if (avgBrightness > 100) {
    return { textColor: "#FFFFFF", strokeColor: "#333333" };
  } else {
    return { textColor: "#FFFFFF", strokeColor: "#000000" };
  }
}

/**
 * Extracts the display text from a typography design concept.
 * Returns null if the concept doesn't have clear text content.
 */
export function extractDisplayText(title: string, description: string): string | null {
  const quotedMatch = description.match(/"([^"]+)"|'([^']+)'/);
  if (quotedMatch) return quotedMatch[1] ?? quotedMatch[2];

  const saysMatch = description.match(/(?:reads?|says?|text|phrase|slogan|quote)[:\s]+"?([^".\n]+)/i);
  if (saysMatch) return saysMatch[1].trim();

  if (title.length <= 40 && /^[A-Za-z0-9\s!?',.-]+$/.test(title)) {
    return title;
  }

  return null;
}

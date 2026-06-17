import { getImageMetadata } from "./upscaler";

export interface ValidationResult {
  passed: boolean;
  checks: {
    dimensions: boolean;
    dpi: boolean;
    format: boolean;
    colorMode: boolean;
    fileSize: boolean;
  };
  details: {
    width: number;
    height: number;
    dpi: number;
    format: string;
    colorMode: string;
    fileSizeBytes: number;
    fileSizeMB: number;
  };
  failures: string[];
}

const MAX_WIDTH = 4500;
const MAX_HEIGHT = 5400;
const MIN_DPI = 300;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_FORMATS = ["png", "svg"];
const REQUIRED_COLOR_MODE = "srgb"; // sharp reports RGB as "srgb"

/**
 * Validates an image against Printify's requirements.
 * Note: We validate the UPSCALED image, not the raw DALL-E output.
 */
export async function validateImage(buffer: Buffer): Promise<ValidationResult> {
  const meta = await getImageMetadata(buffer);
  const failures: string[] = [];

  const dimensionsOk = meta.width <= MAX_WIDTH && meta.height <= MAX_HEIGHT && meta.width > 0 && meta.height > 0;
  if (!dimensionsOk) failures.push(`Dimensions ${meta.width}x${meta.height} exceed max ${MAX_WIDTH}x${MAX_HEIGHT}`);

  const dpiOk = meta.dpi >= MIN_DPI;
  if (!dpiOk) failures.push(`DPI ${meta.dpi} below minimum ${MIN_DPI}`);

  const formatOk = ALLOWED_FORMATS.includes(meta.format.toLowerCase());
  if (!formatOk) failures.push(`Format "${meta.format}" not in allowed: ${ALLOWED_FORMATS.join(", ")}`);

  const colorOk = meta.space === REQUIRED_COLOR_MODE || meta.space === "rgb";
  if (!colorOk) failures.push(`Color mode "${meta.space}" is not RGB/sRGB`);

  const sizeOk = meta.sizeBytes <= MAX_FILE_SIZE_BYTES;
  if (!sizeOk) failures.push(`File size ${(meta.sizeBytes / 1024 / 1024).toFixed(1)}MB exceeds max 50MB`);

  return {
    passed: dimensionsOk && dpiOk && formatOk && colorOk && sizeOk,
    checks: {
      dimensions: dimensionsOk,
      dpi: dpiOk,
      format: formatOk,
      colorMode: colorOk,
      fileSize: sizeOk,
    },
    details: {
      width: meta.width,
      height: meta.height,
      dpi: meta.dpi,
      format: meta.format,
      colorMode: meta.space,
      fileSizeBytes: meta.sizeBytes,
      fileSizeMB: meta.sizeBytes / 1024 / 1024,
    },
    failures,
  };
}

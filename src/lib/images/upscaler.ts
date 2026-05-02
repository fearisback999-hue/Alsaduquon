import sharp from "sharp";

interface UpscaleResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
}

/**
 * Upscales an image to print-ready dimensions.
 * DALL-E 3 outputs 1024x1024 — POD needs up to 4500x5400.
 *
 * Uses fit: "cover" with the lanczos3 kernel so the design fills the entire
 * print area instead of being letterboxed with transparency. A minor edge
 * crop is preferable to a tiny design floating in blank space on the print.
 */
export async function upscaleForPrint(
  inputBuffer: Buffer,
  targetWidth: number = 4500,
  targetHeight: number = 5400,
): Promise<UpscaleResult> {
  const result = await sharp(inputBuffer)
    .resize(targetWidth, targetHeight, {
      fit: "cover",
      kernel: sharp.kernel.lanczos3,
      position: "center",
    })
    .withMetadata({ density: 300 })
    .png({ quality: 100, compressionLevel: 6 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    format: "png",
  };
}

/**
 * Validates and returns image metadata without modifying it.
 */
export async function getImageMetadata(buffer: Buffer): Promise<{
  width: number;
  height: number;
  format: string;
  channels: number;
  space: string;
  dpi: number;
  sizeBytes: number;
}> {
  const metadata = await sharp(buffer).metadata();

  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: metadata.format ?? "unknown",
    channels: metadata.channels ?? 0,
    space: metadata.space ?? "unknown",
    dpi: metadata.density ?? 72,
    sizeBytes: buffer.length,
  };
}

/**
 * Strips AI artifacts: adjusts contrast and sharpness for print.
 */
export async function postProcessForPrint(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer)
    .sharpen({ sigma: 1.0 })
    .modulate({ saturation: 0.95 }) // Slightly reduce oversaturation typical of AI images
    .png({ quality: 100 })
    .toBuffer();
}

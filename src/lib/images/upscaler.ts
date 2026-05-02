import sharp from "sharp";
import { upscaleWithRealESRGAN } from "@/lib/ai/providers";
import { log } from "@/lib/logger";

interface UpscaleResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
  method: "real-esrgan" | "sharp";
}

/**
 * Upscales an image to print-ready dimensions.
 *
 * Two-stage upscale: Real-ESRGAN 4x for true detail-preserving upscaling,
 * then sharp resize to fit the target print dimensions. Real-ESRGAN takes
 * a URL — when only a buffer is available we fall back to high-quality
 * sharp interpolation (cover + lanczos3).
 *
 * Real-ESRGAN cost: ~$0.0023 per image. Falls back silently on failure
 * so a Replicate outage doesn't kill the pipeline.
 */
export async function upscaleForPrint(
  inputBuffer: Buffer,
  targetWidth: number = 4500,
  targetHeight: number = 5400,
  options?: { sourceUrl?: string },
): Promise<UpscaleResult> {
  // Try Real-ESRGAN first if we have a URL and Replicate is configured
  if (options?.sourceUrl && process.env.REPLICATE_API_TOKEN) {
    try {
      const upscaled = await upscaleWithRealESRGAN(options.sourceUrl, 4);
      const result = await sharp(upscaled.buffer)
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
        method: "real-esrgan",
      };
    } catch (error) {
      log("warn", "Real-ESRGAN upscale failed, falling back to sharp", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fallback: sharp with cover + lanczos3
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
    method: "sharp",
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

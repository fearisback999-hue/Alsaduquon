import { put } from "@vercel/blob";
import { withRetry } from "@/lib/retry";
import { log } from "@/lib/logger";

const ALLOWED_HOSTS = [
  "oaidalleapiprodscus.blob.core.windows.net", // DALL-E
  "images-api.printify.com", // Printify mockups
  "placeit-assets.s3.amazonaws.com", // Placeit rendered mockups
  "assets.placeit.net", // Placeit CDN
  "api.placeit.net", // Placeit API direct
];

const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    // Allow Vercel Blob URLs
    if (parsed.hostname.endsWith(".public.blob.vercel-storage.com")) return true;
    return ALLOWED_HOSTS.some((host) => parsed.hostname === host);
  } catch {
    return false;
  }
}

/**
 * Downloads an image from a URL and uploads to Vercel Blob for permanent storage.
 * This is critical for DALL-E images which expire after ~1 hour — we retry
 * aggressively and log the source URL so manual recovery is possible if
 * persistence fails entirely.
 */
export async function persistImage(
  sourceUrl: string,
  fileName: string,
): Promise<{ url: string; pathname: string }> {
  if (!isAllowedUrl(sourceUrl)) {
    throw new Error(`Image URL not from an allowed host: ${new URL(sourceUrl).hostname}`);
  }

  // Log the source URL so it's visible for manual recovery if persistence
  // fails before the URL expires (~1 hour for DALL-E).
  log("info", "Persisting image to Blob", { fileName, sourceUrl });

  const safeName = fileName.replace(/[^a-zA-Z0-9\-_\/.]/g, "_");

  // Retry the download+upload up to 3 times — transient Blob errors are
  // common and losing a just-generated DALL-E image is expensive.
  return await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(sourceUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }

      const contentLength = parseInt(response.headers.get("content-length") ?? "0");
      if (contentLength > MAX_IMAGE_SIZE) {
        throw new Error(`Image too large: ${contentLength} bytes (max ${MAX_IMAGE_SIZE})`);
      }

      const imageBuffer = await response.arrayBuffer();

      if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
        throw new Error(`Image too large: ${imageBuffer.byteLength} bytes (max ${MAX_IMAGE_SIZE})`);
      }

      const blob = await put(safeName, Buffer.from(imageBuffer), {
        access: "public",
        contentType: "image/png",
      });

      return {
        url: blob.url,
        pathname: blob.pathname,
      };
    } finally {
      clearTimeout(timeout);
    }
  }, { maxAttempts: 3, baseDelayMs: 500 });
}

/**
 * Uploads raw image data to Vercel Blob.
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  fileName: string,
  contentType: string = "image/png",
): Promise<{ url: string; pathname: string }> {
  const safeName = fileName.replace(/[^a-zA-Z0-9\-_\/.]/g, "_");

  const blob = await put(safeName, buffer, {
    access: "public",
    contentType,
  });

  return {
    url: blob.url,
    pathname: blob.pathname,
  };
}

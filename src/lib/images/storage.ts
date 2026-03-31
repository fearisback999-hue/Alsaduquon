import { put } from "@vercel/blob";

const ALLOWED_HOSTS = [
  "oaidalleapiprodscus.blob.core.windows.net", // DALL-E
  "images-api.printify.com", // Printify mockups
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
 * This is critical for DALL-E images which expire after ~1 hour.
 */
export async function persistImage(
  sourceUrl: string,
  fileName: string,
): Promise<{ url: string; pathname: string }> {
  if (!isAllowedUrl(sourceUrl)) {
    throw new Error(`Image URL not from an allowed host: ${new URL(sourceUrl).hostname}`);
  }

  // Sanitize fileName: only allow alphanumeric, hyphens, underscores, slashes, dots
  const safeName = fileName.replace(/[^a-zA-Z0-9\-_\/.]/g, "_");

  // Download with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    // Check content length before downloading
    const contentLength = parseInt(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${contentLength} bytes (max ${MAX_IMAGE_SIZE})`);
    }

    const imageBuffer = await response.arrayBuffer();

    if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large: ${imageBuffer.byteLength} bytes (max ${MAX_IMAGE_SIZE})`);
    }

    // Upload to Vercel Blob
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

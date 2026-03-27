import { put } from "@vercel/blob";

/**
 * Downloads an image from a URL and uploads to Vercel Blob for permanent storage.
 * This is critical for DALL-E images which expire after ~1 hour.
 */
export async function persistImage(
  sourceUrl: string,
  fileName: string,
): Promise<{ url: string; pathname: string }> {
  // Download the image
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image from ${sourceUrl}: ${response.status}`);
  }

  const imageBuffer = await response.arrayBuffer();

  // Upload to Vercel Blob
  const blob = await put(fileName, Buffer.from(imageBuffer), {
    access: "public",
    contentType: "image/png",
  });

  return {
    url: blob.url,
    pathname: blob.pathname,
  };
}

/**
 * Uploads raw image data to Vercel Blob.
 */
export async function uploadImageBuffer(
  buffer: Buffer,
  fileName: string,
  contentType: string = "image/png",
): Promise<{ url: string; pathname: string }> {
  const blob = await put(fileName, buffer, {
    access: "public",
    contentType,
  });

  return {
    url: blob.url,
    pathname: blob.pathname,
  };
}

import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "./rate-limiter";
import { log } from "@/lib/logger";

const BASE_URL = "https://api.placeit.net/api/v1";

interface PlaceitTemplate {
  id: number;
  title: string;
  tags: string[];
  thumbnail: string;
  width: number;
  height: number;
}

interface PlaceitRenderResponse {
  id: string;
  status: "processing" | "completed" | "failed";
  result_url?: string;
  thumbnail_url?: string;
  error?: string;
}

async function placeitFetch(path: string, options?: RequestInit): Promise<unknown> {
  await rateLimit("placeit");

  const token = process.env.PLACEIT_API_TOKEN;
  if (!token) {
    throw new ExternalAPIError("Placeit", undefined, "PLACEIT_API_TOKEN not configured");
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Placeit", response.status, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

export function isConfigured(): boolean {
  return !!process.env.PLACEIT_API_TOKEN;
}

export async function getTemplates(
  category: string,
  limit: number = 20,
): Promise<PlaceitTemplate[]> {
  return withRetry(() =>
    placeitFetch(`/templates?category=${encodeURIComponent(category)}&limit=${limit}`),
  ) as Promise<PlaceitTemplate[]>;
}

export async function renderMockup(
  templateId: number,
  imageUrl: string,
  options?: { backgroundColor?: string; crop?: { x: number; y: number; width: number; height: number } },
): Promise<PlaceitRenderResponse> {
  return withRetry(() =>
    placeitFetch("/renders", {
      method: "POST",
      body: JSON.stringify({
        template_id: templateId,
        layers: [
          {
            type: "design",
            url: imageUrl,
            ...(options?.crop ? { crop: options.crop } : {}),
          },
        ],
        ...(options?.backgroundColor ? { background_color: options.backgroundColor } : {}),
      }),
    }),
  ) as Promise<PlaceitRenderResponse>;
}

export async function getRenderStatus(renderId: string): Promise<PlaceitRenderResponse> {
  return withRetry(() =>
    placeitFetch(`/renders/${renderId}`),
  ) as Promise<PlaceitRenderResponse>;
}

export async function waitForRender(
  renderId: string,
  maxWaitMs: number = 60_000,
): Promise<PlaceitRenderResponse> {
  const pollIntervalMs = 2000;
  const maxAttempts = Math.ceil(maxWaitMs / pollIntervalMs);

  for (let i = 0; i < maxAttempts; i++) {
    const status = await getRenderStatus(renderId);

    if (status.status === "completed") return status;
    if (status.status === "failed") {
      throw new ExternalAPIError("Placeit", undefined, `Render failed: ${status.error ?? "unknown"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new ExternalAPIError("Placeit", undefined, `Render timed out after ${maxWaitMs}ms`);
}

export async function renderAndWait(
  templateId: number,
  imageUrl: string,
  options?: { backgroundColor?: string; crop?: { x: number; y: number; width: number; height: number } },
): Promise<{ resultUrl: string; thumbnailUrl?: string }> {
  const render = await renderMockup(templateId, imageUrl, options);

  if (render.status === "completed" && render.result_url) {
    return { resultUrl: render.result_url, thumbnailUrl: render.thumbnail_url };
  }

  const result = await waitForRender(render.id);
  if (!result.result_url) {
    throw new ExternalAPIError("Placeit", undefined, "Render completed but no result URL");
  }

  return { resultUrl: result.result_url, thumbnailUrl: result.thumbnail_url };
}

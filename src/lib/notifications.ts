import { log } from "@/lib/logger";
import { fetchWithTimeout } from "@/lib/external/fetch-timeout";

interface PipelineNotification {
  event: "pipeline_paused" | "pipeline_failed" | "pipeline_completed" | "budget_exceeded";
  runId: string;
  message: string;
  data?: Record<string, unknown>;
}

async function postWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    log("info", `[Notification] No NOTIFICATION_WEBHOOK_URL configured — skipping: ${event}`);
    return;
  }

  try {
    const response = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, event, timestamp: new Date().toISOString(), app: "NeoPOD" }),
    }, 10_000);

    if (!response.ok) {
      log("warn", `[Notification] Webhook returned ${response.status} for ${event}`);
    }
  } catch (error) {
    log("warn", `[Notification] Failed to send ${event} webhook`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendPipelineNotification(notification: PipelineNotification): Promise<void> {
  await postWebhook(notification.event, {
    runId: notification.runId,
    message: notification.message,
    data: notification.data,
  });
}

/**
 * Operational alert that isn't tied to a pipeline run — e.g. margin drift or a
 * "you can safely raise your daily limit" advisory. Always logs (so it's
 * visible without a webhook) and fires the webhook when configured.
 */
export async function sendOperationalAlert(
  kind: "margin_drift" | "listing_limit_advice",
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  log("warn", `[Alert:${kind}] ${message}`, data);
  await postWebhook(`operational_alert:${kind}`, { message, data });
}

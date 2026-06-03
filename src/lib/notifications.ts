import { log } from "@/lib/logger";
import { fetchWithTimeout } from "@/lib/external/fetch-timeout";

interface PipelineNotification {
  event: "pipeline_paused" | "pipeline_failed" | "pipeline_completed" | "budget_exceeded";
  runId: string;
  message: string;
  data?: Record<string, unknown>;
}

export async function sendPipelineNotification(notification: PipelineNotification): Promise<void> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    log("info", `[Notification] No NOTIFICATION_WEBHOOK_URL configured — skipping: ${notification.event}: ${notification.message}`);
    return;
  }

  try {
    const payload = {
      ...notification,
      timestamp: new Date().toISOString(),
      app: "NeoPOD",
    };

    const response = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, 10_000);

    if (!response.ok) {
      log("warn", `[Notification] Webhook returned ${response.status} for ${notification.event}`);
    }
  } catch (error) {
    log("warn", `[Notification] Failed to send ${notification.event} webhook`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

import { Badge, type BadgeTone } from "./badge";

const STATUS_TONE: Record<string, BadgeTone> = {
  completed: "success",
  running: "info",
  pending: "warning",
  pending_approval: "warning",
  failed: "danger",
  paused: "warning",
  approved: "success",
  rejected: "danger",
  published: "success",
  draft: "neutral",
  deactivated: "neutral",
  discovered: "info",
  scored: "brand",
  active: "success",
  generated: "brand",
  validated: "success",
  moderated: "info",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  running: "Running",
  pending: "Pending",
  pending_approval: "Pending Approval",
  failed: "Failed",
  paused: "Paused",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  draft: "Draft",
  deactivated: "Deactivated",
  discovered: "Discovered",
  scored: "Scored",
  active: "Active",
  generated: "Generated",
  validated: "Validated",
  moderated: "Moderated",
};

export function StatusBadge({ status, showDot = true }: { status: string; showDot?: boolean }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const label = STATUS_LABEL[status] ?? status;
  const isRunning = status === "running" || status === "active";

  return (
    <Badge tone={tone} dot={showDot}>
      {isRunning && showDot && (
        <span className="relative -ml-3 mr-0.5 flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-70 animate-ping" />
        </span>
      )}
      {label}
    </Badge>
  );
}

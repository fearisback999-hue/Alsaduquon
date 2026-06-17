import type { HTMLAttributes } from "react";

export type ProgressTone = "brand" | "success" | "warning" | "danger" | "info";

interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  tone?: ProgressTone;
  size?: "xs" | "sm" | "md";
  indeterminate?: boolean;
}

const toneClasses: Record<ProgressTone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

const sizeClasses = {
  xs: "h-1",
  sm: "h-1.5",
  md: "h-2",
};

export function Progress({
  value,
  max = 100,
  tone = "brand",
  size = "sm",
  indeterminate = false,
  className = "",
  ...rest
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={`w-full overflow-hidden rounded-full bg-surface-2 ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ease-out ${toneClasses[tone]} ${
          indeterminate ? "animate-pulse w-1/3" : ""
        }`}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}

export function DualProgress({
  label,
  current,
  max,
  tone = "brand",
  formatter,
}: {
  label: string;
  current: number;
  max: number;
  tone?: ProgressTone;
  formatter?: (value: number) => string;
}) {
  const fmt = formatter ?? ((v: number) => v.toString());
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  const effectiveTone: ProgressTone = pct >= 90 ? "danger" : pct >= 70 ? "warning" : tone;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <span className="text-xs tabular-nums text-fg-subtle">
          {fmt(current)} <span className="text-fg-faint">/ {fmt(max)}</span>
        </span>
      </div>
      <Progress value={current} max={max} tone={effectiveTone} />
    </div>
  );
}

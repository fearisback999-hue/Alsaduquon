"use client";

import type { ReactNode } from "react";
import { Sparkline } from "./sparkline";

type StatTone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";
type TrendDirection = "up" | "down" | "flat";

interface StatCardProps {
  label: string;
  value: string | number;
  detail?: string;
  tone?: StatTone;
  icon?: ReactNode;
  trend?: {
    direction: TrendDirection;
    label: string;
  };
  sparkline?: number[];
}

const toneIconBg: Record<StatTone, string> = {
  brand: "bg-brand-subtle text-brand",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
  neutral: "bg-surface-2 text-fg-subtle",
};

const toneSparkColor: Record<StatTone, string> = {
  brand: "rgb(var(--brand))",
  success: "rgb(var(--success))",
  warning: "rgb(var(--warning))",
  danger: "rgb(var(--danger))",
  info: "rgb(var(--info))",
  neutral: "rgb(var(--fg-subtle))",
};

const toneAccent: Record<StatTone, string> = {
  brand: "from-brand/5 to-transparent",
  success: "from-success/5 to-transparent",
  warning: "from-warning/5 to-transparent",
  danger: "from-danger/5 to-transparent",
  info: "from-info/5 to-transparent",
  neutral: "from-surface-2/50 to-transparent",
};

const trendClasses: Record<TrendDirection, string> = {
  up: "text-success",
  down: "text-danger",
  flat: "text-fg-subtle",
};

const trendGlyph: Record<TrendDirection, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

export function StatCard({ label, value, detail, tone = "neutral", icon, trend, sparkline }: StatCardProps) {
  return (
    <div className="card card-hover p-5 relative overflow-hidden group">
      <div className={`absolute inset-0 bg-gradient-to-br ${toneAccent[tone]} pointer-events-none`} />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon && (
              <span className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${toneIconBg[tone]}`}>
                {icon}
              </span>
            )}
            <p className="text-xs font-medium text-fg-subtle uppercase tracking-wide">{label}</p>
          </div>
          <p className="text-2xl font-bold text-fg mt-2 tabular-nums tracking-tight">{value}</p>
          <div className="flex items-center gap-2 mt-1 min-h-[18px]">
            {trend && (
              <span className={`text-xs font-semibold tabular-nums ${trendClasses[trend.direction]}`}>
                <span aria-hidden>{trendGlyph[trend.direction]}</span> {trend.label}
              </span>
            )}
            {detail && <p className="text-xs text-fg-subtle">{detail}</p>}
          </div>
        </div>
        {sparkline && sparkline.length > 0 && (
          <div className="flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity duration-200">
            <Sparkline data={sparkline} color={toneSparkColor[tone]} width={80} height={32} />
          </div>
        )}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}
    >
      {icon && (
        <div className="mb-4 h-12 w-12 rounded-full bg-surface-2 flex items-center justify-center text-fg-subtle">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-fg mb-1">{title}</h3>
      {description && <p className="text-sm text-fg-subtle max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

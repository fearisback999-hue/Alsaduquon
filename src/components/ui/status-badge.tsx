const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  running: "bg-blue-100 text-blue-800",
  pending: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
  paused: "bg-orange-100 text-orange-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  published: "bg-green-100 text-green-800",
  draft: "bg-gray-100 text-gray-800",
  discovered: "bg-blue-100 text-blue-800",
  scored: "bg-purple-100 text-purple-800",
  active: "bg-green-100 text-green-800",
  generated: "bg-indigo-100 text-indigo-800",
  validated: "bg-emerald-100 text-emerald-800",
  moderated: "bg-cyan-100 text-cyan-800",
};

export function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  detail?: string;
  color?: "blue" | "green" | "red" | "yellow" | "gray";
}

const colorClasses = {
  blue: "border-blue-200 bg-blue-50",
  green: "border-green-200 bg-green-50",
  red: "border-red-200 bg-red-50",
  yellow: "border-yellow-200 bg-yellow-50",
  gray: "border-gray-200 bg-gray-50",
};

export function StatCard({ label, value, detail, color = "gray" }: StatCardProps) {
  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
    </div>
  );
}

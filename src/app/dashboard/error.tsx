"use client";

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-8 text-center">
      <h2 className="text-xl font-bold text-red-600 mb-2">Something went wrong</h2>
      <p className="text-gray-500 mb-4">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
        Try again
      </button>
    </div>
  );
}

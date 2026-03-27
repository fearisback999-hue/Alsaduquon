"use client";

import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

interface Design {
  id: string;
  title: string;
  description: string | null;
  designType: string | null;
  status: string;
  images: Array<{ storageUrl: string | null; status: string; attempt: number }>;
  niche: { name: string } | null;
}

export default function DesignsPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const res = await fetch("/api/designs");
    if (res.ok) {
      const data = await res.json();
      setDesigns(data.designs ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  if (loading) return <div className="text-center text-gray-500 py-8">Loading designs...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Designs</h1>

      {designs.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-gray-500">No designs generated yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {designs.map((design) => (
            <div key={design.id} className="bg-white rounded-lg border overflow-hidden">
              <div className="aspect-square bg-gray-100">
                {design.images[0]?.storageUrl ? (
                  <img src={design.images[0].storageUrl} alt={design.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No image</div>
                )}
              </div>
              <div className="p-3">
                <h3 className="font-medium text-sm truncate">{design.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={design.status} />
                  {design.designType && <span className="text-xs text-gray-400">{design.designType}</span>}
                </div>
                {design.niche && <p className="text-xs text-gray-500 mt-1">{design.niche.name}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

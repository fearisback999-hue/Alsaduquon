"use client";

import { useState, useEffect } from "react";

interface Setting {
  id: string;
  key: string;
  value: string;
  type: string;
  group: string;
  description: string | null;
}

const GROUPS = ["pipeline", "pricing", "limits", "api", "general"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const res = await fetch("/api/settings");
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings ?? []);
      const values: Record<string, string> = {};
      for (const s of data.settings ?? []) values[s.key] = s.value;
      setEditValues(values);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function saveSetting(key: string) {
    setSaving(key);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: editValues[key] }),
    });
    setSaving(null);
    loadData();
  }

  if (loading) return <div className="text-center text-gray-500 py-8">Loading settings...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {GROUPS.map((group) => {
        const groupSettings = settings.filter((s) => s.group === group);
        if (groupSettings.length === 0) return null;

        return (
          <div key={group} className="bg-white rounded-lg border mb-6">
            <h2 className="font-medium p-4 border-b text-sm text-gray-500 uppercase tracking-wide">{group}</h2>
            <div className="divide-y">
              {groupSettings.map((setting) => (
                <div key={setting.key} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 font-mono">{setting.key}</p>
                    {setting.description && <p className="text-xs text-gray-500 mt-0.5">{setting.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editValues[setting.key] ?? ""}
                      onChange={(e) => setEditValues({ ...editValues, [setting.key]: e.target.value })}
                      className="w-48 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => saveSetting(setting.key)}
                      disabled={saving === setting.key || editValues[setting.key] === setting.value}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving === setting.key ? "..." : "Save"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

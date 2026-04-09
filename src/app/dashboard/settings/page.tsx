"use client";

import { useState, useEffect } from "react";
import { PRODUCT_CONFIGS, ALL_PRODUCT_TYPES } from "@/lib/printify/product-config";

interface Setting {
  id: string;
  key: string;
  value: string;
  type: string;
  group: string;
  description: string | null;
}

const GROUPS = ["pipeline", "pricing", "limits", "api", "general"];

const CATEGORIES: Record<string, string> = {
  apparel: "Apparel",
  drinkware: "Drinkware",
  bags: "Bags",
  wall_art: "Wall Art",
  accessories: "Accessories",
  home: "Home",
};

const CATEGORY_ORDER = ["apparel", "drinkware", "bags", "wall_art", "accessories", "home"];

function getProductsByCategory(): Record<string, Array<{ key: string; displayName: string }>> {
  const grouped: Record<string, Array<{ key: string; displayName: string }>> = {};
  for (const [key, config] of Object.entries(PRODUCT_CONFIGS)) {
    if (!grouped[config.category]) grouped[config.category] = [];
    grouped[config.category].push({ key, displayName: config.displayName });
  }
  return grouped;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabledProducts, setEnabledProducts] = useState<Set<string>>(new Set());
  const [savingProducts, setSavingProducts] = useState(false);

  const productsByCategory = getProductsByCategory();

  async function loadData() {
    setLoading(true);
    const res = await fetch("/api/settings");
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings ?? []);
      const values: Record<string, string> = {};
      for (const s of data.settings ?? []) {
        values[s.key] = s.value;
        if (s.key === "enabled_product_types") {
          try {
            const arr = JSON.parse(s.value);
            if (Array.isArray(arr)) setEnabledProducts(new Set(arr));
          } catch { /* ignore */ }
        }
      }
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

  async function saveEnabledProducts(newSet: Set<string>) {
    setEnabledProducts(newSet);
    setSavingProducts(true);
    const arr = Array.from(newSet);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "enabled_product_types", value: JSON.stringify(arr) }),
    });
    setSavingProducts(false);
  }

  function toggleProduct(key: string) {
    const newSet = new Set(enabledProducts);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    saveEnabledProducts(newSet);
  }

  function toggleCategory(category: string, enable: boolean) {
    const newSet = new Set(enabledProducts);
    const products = productsByCategory[category] ?? [];
    for (const p of products) {
      if (enable) newSet.add(p.key);
      else newSet.delete(p.key);
    }
    saveEnabledProducts(newSet);
  }

  if (loading) return <div className="text-center text-gray-500 py-8">Loading settings...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Product Types Selector */}
      <div className="bg-white rounded-lg border mb-6">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="font-medium text-sm text-gray-500 uppercase tracking-wide">Product Types</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {enabledProducts.size} of {ALL_PRODUCT_TYPES.length} products enabled
              {savingProducts && <span className="ml-2 text-blue-500">Saving...</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => saveEnabledProducts(new Set(ALL_PRODUCT_TYPES))}
              className="px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
            >
              Enable All
            </button>
            <button
              onClick={() => saveEnabledProducts(new Set())}
              className="px-3 py-1.5 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
            >
              Disable All
            </button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {CATEGORY_ORDER.map((category) => {
            const products = productsByCategory[category];
            if (!products) return null;
            const allEnabled = products.every((p) => enabledProducts.has(p.key));
            const someEnabled = products.some((p) => enabledProducts.has(p.key));
            const enabledCount = products.filter((p) => enabledProducts.has(p.key)).length;

            return (
              <div key={category}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-gray-700">{CATEGORIES[category]}</h3>
                    <span className="text-xs text-gray-400">{enabledCount}/{products.length}</span>
                  </div>
                  <button
                    onClick={() => toggleCategory(category, !allEnabled)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {allEnabled ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {products.map((product) => {
                    const enabled = enabledProducts.has(product.key);
                    return (
                      <button
                        key={product.key}
                        onClick={() => toggleProduct(product.key)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-colors ${
                          enabled
                            ? "bg-blue-50 border-blue-200 text-blue-900"
                            : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                          enabled ? "bg-blue-600 border-blue-600" : "border-gray-300"
                        }`}>
                          {enabled && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span className="truncate">{product.displayName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Throughput & Budget Controls */}
      <div className="bg-white rounded-lg border mb-6">
        <div className="p-4 border-b">
          <h2 className="font-medium text-sm text-gray-500 uppercase tracking-wide">Throughput & Budget</h2>
          <p className="text-xs text-gray-400 mt-0.5">Control how fast and how much the pipeline spends</p>
        </div>
        <div className="divide-y">
          {[
            { key: "max_daily_listings", label: "Max Daily Listings", desc: "Maximum listings published per day", suffix: "listings/day" },
            { key: "max_daily_cost", label: "Daily Budget", desc: "Maximum daily AI/API spend", suffix: "USD/day", prefix: "$" },
            { key: "concepts_per_niche", label: "Concepts per Niche", desc: "Design concepts generated per approved niche", suffix: "concepts" },
            { key: "max_products_per_design", label: "Products per Design", desc: "Printify products created per design (controls cost per concept)", suffix: "products" },
            { key: "pipeline_runs_per_day", label: "Pipeline Runs per Day", desc: "1 = morning only (6 AM UTC), 2 = morning + afternoon (6 AM + 2 PM UTC)", suffix: "runs" },
          ].map((control) => (
            <div key={control.key} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{control.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{control.desc}</p>
              </div>
              <div className="flex items-center gap-2">
                {control.prefix && <span className="text-sm text-gray-500">{control.prefix}</span>}
                <input
                  type="number"
                  min="1"
                  step={control.key === "max_daily_cost" ? "0.50" : "1"}
                  value={editValues[control.key] ?? ""}
                  onChange={(e) => setEditValues({ ...editValues, [control.key]: e.target.value })}
                  className="w-24 px-3 py-1.5 border border-gray-300 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-400 w-20">{control.suffix}</span>
                <button
                  onClick={() => saveSetting(control.key)}
                  disabled={saving === control.key || editValues[control.key] === settings.find((s) => s.key === control.key)?.value}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving === control.key ? "..." : "Save"}
                </button>
              </div>
            </div>
          ))}
          {/* Seasonal Boost Toggle */}
          <div className="p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">Seasonal Boost</p>
              <p className="text-xs text-gray-500 mt-0.5">Boost seasonal niches during holiday prep windows (Valentine&apos;s, Halloween, Christmas, etc.)</p>
            </div>
            <button
              onClick={() => {
                const newVal = editValues["seasonal_boost_enabled"] === "false" ? "true" : "false";
                setEditValues({ ...editValues, seasonal_boost_enabled: newVal });
                fetch("/api/settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "seasonal_boost_enabled", value: newVal }),
                }).then(() => loadData());
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                editValues["seasonal_boost_enabled"] !== "false" ? "bg-blue-600" : "bg-gray-300"
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                editValues["seasonal_boost_enabled"] !== "false" ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* Other Settings */}
      {GROUPS.map((group) => {
        const THROUGHPUT_KEYS = new Set(["max_daily_listings", "max_daily_cost", "concepts_per_niche", "max_products_per_design", "pipeline_runs_per_day", "seasonal_boost_enabled"]);
        const groupSettings = settings.filter((s) => s.group === group && s.key !== "enabled_product_types" && !THROUGHPUT_KEYS.has(s.key));
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

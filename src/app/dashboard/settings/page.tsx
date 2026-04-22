"use client";

import { useState, useEffect } from "react";
import { Check, Package, Sliders, Key, Settings as SettingsIcon, Loader2, Sparkles } from "lucide-react";
import { PRODUCT_CONFIGS, ALL_PRODUCT_TYPES } from "@/lib/printify/product-config";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

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

function Toggle({ enabled, onClick, disabled }: { enabled: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
        enabled ? "bg-brand" : "bg-border-strong"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
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
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const THROUGHPUT_KEYS = new Set([
    "max_daily_listings",
    "max_daily_cost",
    "concepts_per_niche",
    "max_products_per_design",
    "pipeline_runs_per_day",
    "seasonal_boost_enabled",
    "enabled_product_types",
  ]);

  return (
    <div className="space-y-6 animate-fade-in-up max-w-5xl">
      <div className="page-header">
        <h1 className="text-2xl font-bold text-fg tracking-tight">Settings</h1>
        <p className="text-sm text-fg-subtle mt-1">Configure budgets, throughput, and integrations.</p>
      </div>

      {/* Product Types */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-brand-subtle text-brand flex items-center justify-center flex-shrink-0">
                <Package className="h-4 w-4" strokeWidth={2} />
              </div>
              <div>
                <CardTitle>Product Types</CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <span>
                    <span className="text-fg font-medium tabular-nums">{enabledProducts.size}</span> of{" "}
                    <span className="tabular-nums">{ALL_PRODUCT_TYPES.length}</span> enabled
                  </span>
                  {savingProducts && (
                    <span className="inline-flex items-center gap-1 text-info">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving…
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => saveEnabledProducts(new Set(ALL_PRODUCT_TYPES))}
              >
                Enable all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => saveEnabledProducts(new Set())}
              >
                Disable all
              </Button>
            </div>
          </div>
        </CardHeader>

        <div className="px-5 pb-5 space-y-5">
          {CATEGORY_ORDER.map((category) => {
            const products = productsByCategory[category];
            if (!products) return null;
            const allEnabled = products.every((p) => enabledProducts.has(p.key));
            const enabledCount = products.filter((p) => enabledProducts.has(p.key)).length;

            return (
              <div key={category}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-fg">{CATEGORIES[category]}</h3>
                    <Badge tone={enabledCount > 0 ? "brand" : "neutral"}>
                      {enabledCount}/{products.length}
                    </Badge>
                  </div>
                  <button
                    onClick={() => toggleCategory(category, !allEnabled)}
                    className="text-xs font-medium text-brand hover:text-brand-hover transition-colors"
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
                        className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                          enabled
                            ? "bg-brand-subtle border-brand/30 text-fg"
                            : "bg-surface border-border text-fg-muted hover:bg-surface-hover hover:border-border-strong hover:text-fg"
                        }`}
                      >
                        <span
                          className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                            enabled ? "bg-brand border-brand" : "border-border-strong group-hover:border-fg-faint"
                          }`}
                        >
                          {enabled && <Check className="w-2.5 h-2.5 text-brand-fg" strokeWidth={3} />}
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
      </Card>

      {/* Throughput & Budget */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-success-subtle text-success flex items-center justify-center flex-shrink-0">
              <Sliders className="h-4 w-4" strokeWidth={2} />
            </div>
            <div>
              <CardTitle>Throughput & Budget</CardTitle>
              <CardDescription>Control how fast and how much the pipeline spends.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <div className="divide-y divide-border">
          {[
            { key: "max_daily_listings", label: "Max Daily Listings", desc: "Maximum listings published per day", suffix: "listings/day" },
            { key: "max_daily_cost", label: "Daily Budget", desc: "Maximum daily AI/API spend", suffix: "USD/day", prefix: "$" },
            { key: "concepts_per_niche", label: "Concepts per Niche", desc: "Design concepts generated per approved niche", suffix: "concepts" },
            { key: "max_products_per_design", label: "Products per Design", desc: "Printify products created per design (controls cost per concept)", suffix: "products" },
            { key: "pipeline_runs_per_day", label: "Pipeline Runs per Day", desc: "1 = morning only (6 AM UTC), 2 = morning + afternoon", suffix: "runs" },
          ].map((control) => {
            const currentValue = settings.find((s) => s.key === control.key)?.value;
            const dirty = editValues[control.key] !== currentValue;
            return (
              <div key={control.key} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg">{control.label}</p>
                  <p className="text-xs text-fg-subtle mt-0.5">{control.desc}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="relative">
                    {control.prefix && (
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-fg-faint tabular-nums">
                        {control.prefix}
                      </span>
                    )}
                    <input
                      type="number"
                      min="1"
                      step={control.key === "max_daily_cost" ? "0.50" : "1"}
                      value={editValues[control.key] ?? ""}
                      onChange={(e) => setEditValues({ ...editValues, [control.key]: e.target.value })}
                      className={`w-24 h-9 ${control.prefix ? "pl-6" : "pl-3"} pr-3 bg-surface border border-border rounded-lg text-sm text-right tabular-nums text-fg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all`}
                    />
                  </div>
                  <span className="text-xs text-fg-faint w-20">{control.suffix}</span>
                  <Button
                    size="sm"
                    onClick={() => saveSetting(control.key)}
                    disabled={saving === control.key || !dirty}
                    loading={saving === control.key}
                  >
                    Save
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Seasonal Boost Toggle */}
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="flex-1 min-w-0 flex items-start gap-3">
              <Sparkles className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" strokeWidth={2} />
              <div>
                <p className="text-sm font-medium text-fg">Seasonal Boost</p>
                <p className="text-xs text-fg-subtle mt-0.5">
                  Boost seasonal niches during holiday prep windows (Valentine&apos;s, Halloween, Christmas, etc.)
                </p>
              </div>
            </div>
            <Toggle
              enabled={editValues["seasonal_boost_enabled"] !== "false"}
              onClick={() => {
                const newVal = editValues["seasonal_boost_enabled"] === "false" ? "true" : "false";
                setEditValues({ ...editValues, seasonal_boost_enabled: newVal });
                fetch("/api/settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: "seasonal_boost_enabled", value: newVal }),
                }).then(() => loadData());
              }}
            />
          </div>
        </div>
      </Card>

      {/* Other Settings */}
      {GROUPS.map((group) => {
        const groupSettings = settings.filter((s) => s.group === group && !THROUGHPUT_KEYS.has(s.key));
        if (groupSettings.length === 0) return null;

        const groupIcons: Record<string, React.ReactNode> = {
          api: <Key className="h-4 w-4" strokeWidth={2} />,
          pipeline: <SettingsIcon className="h-4 w-4" strokeWidth={2} />,
          pricing: <Sliders className="h-4 w-4" strokeWidth={2} />,
          limits: <Sliders className="h-4 w-4" strokeWidth={2} />,
          general: <SettingsIcon className="h-4 w-4" strokeWidth={2} />,
        };

        const groupTones: Record<string, string> = {
          api: "bg-info-subtle text-info",
          pipeline: "bg-brand-subtle text-brand",
          pricing: "bg-warning-subtle text-warning",
          limits: "bg-danger-subtle text-danger",
          general: "bg-surface-2 text-fg-muted",
        };

        return (
          <Card key={group}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${groupTones[group] ?? "bg-surface-2 text-fg-muted"}`}>
                  {groupIcons[group] ?? <SettingsIcon className="h-4 w-4" strokeWidth={2} />}
                </div>
                <div>
                  <CardTitle className="capitalize">{group}</CardTitle>
                  <CardDescription>{groupSettings.length} setting{groupSettings.length === 1 ? "" : "s"}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <div className="divide-y divide-border">
              {groupSettings.map((setting) => {
                const dirty = editValues[setting.key] !== setting.value;
                return (
                  <div key={setting.key} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-medium text-fg break-all">{setting.key}</p>
                      {setting.description && (
                        <p className="text-xs text-fg-subtle mt-0.5">{setting.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input
                        type="text"
                        value={editValues[setting.key] ?? ""}
                        onChange={(e) => setEditValues({ ...editValues, [setting.key]: e.target.value })}
                        className="w-48 h-9 px-3 bg-surface border border-border rounded-lg text-sm text-fg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all"
                      />
                      <Button
                        size="sm"
                        onClick={() => saveSetting(setting.key)}
                        disabled={saving === setting.key || !dirty}
                        loading={saving === setting.key}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

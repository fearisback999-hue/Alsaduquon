"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Package, Sliders, Key, Settings as SettingsIcon, Loader2, Sparkles } from "lucide-react";
import { PRODUCT_CONFIGS, ALL_PRODUCT_TYPES } from "@/lib/printify/product-config";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

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

// Per-key UI hints — what kind of input control to render and any constraints
interface FieldSpec {
  control: "select" | "number" | "text" | "boolean";
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

const FIELD_SPECS: Record<string, FieldSpec> = {
  niche_score_threshold: { control: "number", min: 0, max: 10, step: 0.1 },
  concepts_per_niche: { control: "number", min: 1, max: 20, step: 1 },
  max_image_attempts: { control: "number", min: 1, max: 5, step: 1 },
  mockups_per_product: { control: "number", min: 1, max: 20, step: 1 },
  approval_batch_size: { control: "number", min: 1, max: 50, step: 1 },
  approval_mode: {
    control: "select",
    options: [
      { value: "manual", label: "Manual review" },
      { value: "auto", label: "Auto-approve" },
    ],
  },
  training_wheels_enabled: {
    control: "select",
    options: [
      { value: "true", label: "Enabled" },
      { value: "false", label: "Disabled" },
    ],
  },
  training_wheels_min_reviews: { control: "number", min: 0, max: 500, step: 1 },
  base_price: { control: "number", min: 1, max: 500, step: 0.5 },
  margin_percent: { control: "number", min: 0, max: 500, step: 1 },
  max_title_length: { control: "number", min: 20, max: 140, step: 1 },
  max_tags: { control: "number", min: 1, max: 13, step: 1 },
  max_daily_cost: { control: "number", min: 0.5, max: 10000, step: 0.5 },
  max_daily_listings: { control: "number", min: 1, max: 500, step: 1 },
  max_products_per_design: { control: "number", min: 1, max: 16, step: 1 },
  pipeline_runs_per_day: { control: "number", min: 1, max: 4, step: 1 },
  image_generator: {
    control: "select",
    options: [
      { value: "auto", label: "Auto (prefer Flux, fall back to DALL-E)" },
      { value: "flux", label: "Flux only (Replicate — $0.06/image)" },
      { value: "dalle", label: "DALL-E only (OpenAI — $0.08/image)" },
    ],
  },
  gpt_model: {
    control: "select",
    options: [
      { value: "gpt-4o", label: "GPT-4o (recommended)" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini (cheaper)" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { value: "gpt-4", label: "GPT-4" },
      { value: "gpt-4.1", label: "GPT-4.1" },
      { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
      { value: "o3-mini", label: "o3-mini" },
    ],
  },
  seasonal_boost_enabled: {
    control: "select",
    options: [
      { value: "true", label: "Enabled" },
      { value: "false", label: "Disabled" },
    ],
  },
  autopilot_enabled: {
    control: "select",
    options: [
      { value: "true", label: "Enabled" },
      { value: "false", label: "Disabled" },
    ],
  },
  annual_revenue_goal: { control: "number", min: 1000, max: 100_000_000, step: 1000 },
};

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
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabledProducts, setEnabledProducts] = useState<Set<string>>(new Set());
  const [savingProducts, setSavingProducts] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const toast = useToast();

  const productsByCategory = getProductsByCategory();

  // Loads settings WITHOUT clobbering scroll position. Settings refetch in the
  // background after each save so the "✓ Saved" indicator can stay in place.
  const loadData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
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
      setEditValues((prev) => ({ ...values, ...prev }));
    }
    if (showSpinner) setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function saveSetting(key: string) {
    setSaving(key);
    setValidationErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: editValues[key] ?? "" }),
      });
      if (res.ok) {
        setSavedFlash(key);
        setTimeout(() => setSavedFlash((curr) => (curr === key ? null : curr)), 1800);
        // Refetch silently — don't trigger the loading skeleton or scroll reset
        loadData(false);
      } else {
        const data = await res.json().catch(() => null);
        const errMsg = data?.error ?? "Save failed";
        setValidationErrors((prev) => ({ ...prev, [key]: errMsg }));
        toast.error(`${key}: ${errMsg}`);
      }
    } catch {
      toast.error("Network error");
      setValidationErrors((prev) => ({ ...prev, [key]: "Network error" }));
    } finally {
      setSaving(null);
    }
  }

  async function saveEnabledProducts(newSet: Set<string>) {
    setEnabledProducts(newSet);
    setSavingProducts(true);
    const arr = Array.from(newSet);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "enabled_product_types", value: JSON.stringify(arr) }),
    });
    setSavingProducts(false);
    if (!res.ok) {
      toast.error("Failed to save product types");
    }
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
      <div className="space-y-6 max-w-5xl animate-fade-in">
        <div className="page-header">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        {/* Product Types skeleton */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3.5 w-44" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        </div>
        {/* Throughput & Budget skeleton */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-56" />
            </div>
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-t border-border">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-24 rounded-lg" />
                <Skeleton className="h-8 w-14 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
        {/* Other settings skeleton */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-3 border-t border-border">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-48 rounded-lg" />
                <Skeleton className="h-8 w-14 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
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
            const fieldError = validationErrors[control.key];
            const inputId = `setting-${control.key}`;
            const spec = FIELD_SPECS[control.key];
            return (
              <div key={control.key} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-0">
                  <label htmlFor={inputId} className="text-sm font-medium text-fg cursor-pointer">{control.label}</label>
                  <p className="text-xs text-fg-subtle mt-0.5">{control.desc}</p>
                  {fieldError && (
                    <p className="text-xs text-danger mt-1">{fieldError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="relative">
                    {control.prefix && (
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-fg-faint tabular-nums">
                        {control.prefix}
                      </span>
                    )}
                    <input
                      id={inputId}
                      type="number"
                      min={spec?.min ?? 1}
                      max={spec?.max}
                      step={spec?.step ?? 1}
                      value={editValues[control.key] ?? ""}
                      onChange={(e) => {
                        setEditValues({ ...editValues, [control.key]: e.target.value });
                        if (validationErrors[control.key]) {
                          setValidationErrors({ ...validationErrors, [control.key]: "" });
                        }
                      }}
                      aria-invalid={!!fieldError}
                      className={`w-24 h-9 ${control.prefix ? "pl-6" : "pl-3"} pr-3 bg-surface border rounded-lg text-sm text-right tabular-nums text-fg focus:outline-none focus:ring-2 transition-all ${
                        fieldError
                          ? "border-danger focus:border-danger focus:ring-danger/20"
                          : "border-border focus:border-brand focus:ring-brand/20"
                      }`}
                    />
                  </div>
                  <span className="text-xs text-fg-faint w-20">{control.suffix}</span>
                  {savedFlash === control.key && (
                    <span className="text-xs text-success font-medium animate-fade-in">✓ Saved</span>
                  )}
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
                }).then((res) => {
                  if (!res.ok) toast.error("Failed to update seasonal boost");
                  loadData(false);
                });
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
                const spec = FIELD_SPECS[setting.key];
                const fieldError = validationErrors[setting.key];
                return (
                  <div key={setting.key} className="px-5 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-medium text-fg break-all">{setting.key}</p>
                      {setting.description && (
                        <p className="text-xs text-fg-subtle mt-0.5">{setting.description}</p>
                      )}
                      {fieldError && (
                        <p className="text-xs text-danger mt-1">{fieldError}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {spec?.control === "select" && spec.options ? (
                        <select
                          value={editValues[setting.key] ?? ""}
                          onChange={(e) => {
                            setEditValues({ ...editValues, [setting.key]: e.target.value });
                            if (validationErrors[setting.key]) setValidationErrors({ ...validationErrors, [setting.key]: "" });
                          }}
                          className={`w-48 h-9 px-3 bg-surface border rounded-lg text-sm text-fg focus:outline-none focus:ring-2 transition-all ${
                            fieldError ? "border-danger focus:border-danger focus:ring-danger/20" : "border-border focus:border-brand focus:ring-brand/20"
                          }`}
                        >
                          {spec.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : spec?.control === "number" ? (
                        <input
                          type="number"
                          min={spec.min}
                          max={spec.max}
                          step={spec.step ?? 1}
                          value={editValues[setting.key] ?? ""}
                          onChange={(e) => {
                            setEditValues({ ...editValues, [setting.key]: e.target.value });
                            if (validationErrors[setting.key]) setValidationErrors({ ...validationErrors, [setting.key]: "" });
                          }}
                          aria-invalid={!!fieldError}
                          className={`w-48 h-9 px-3 bg-surface border rounded-lg text-sm text-right tabular-nums text-fg focus:outline-none focus:ring-2 transition-all ${
                            fieldError ? "border-danger focus:border-danger focus:ring-danger/20" : "border-border focus:border-brand focus:ring-brand/20"
                          }`}
                        />
                      ) : (
                        <input
                          type="text"
                          value={editValues[setting.key] ?? ""}
                          onChange={(e) => {
                            setEditValues({ ...editValues, [setting.key]: e.target.value });
                            if (validationErrors[setting.key]) setValidationErrors({ ...validationErrors, [setting.key]: "" });
                          }}
                          aria-invalid={!!fieldError}
                          className={`w-48 h-9 px-3 bg-surface border rounded-lg text-sm text-fg focus:outline-none focus:ring-2 transition-all ${
                            fieldError ? "border-danger focus:border-danger focus:ring-danger/20" : "border-border focus:border-brand focus:ring-brand/20"
                          }`}
                        />
                      )}
                      {savedFlash === setting.key && (
                        <span className="text-xs text-success font-medium">✓ Saved</span>
                      )}
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

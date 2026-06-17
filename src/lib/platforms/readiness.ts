/**
 * Reports which sales platforms have their credentials configured, so an
 * operator can see at a glance what's ready to enable. The platform strategies
 * are all implemented — turning a platform on is purely a matter of setting its
 * env vars and adding it to the enabled_platforms setting.
 */

export interface PlatformReadiness {
  id: string;
  label: string;
  configured: boolean;
  missingEnv: string[];
  capabilities: { publish: boolean; orderSync: boolean; metricsSync: boolean };
  note?: string;
}

const PLATFORM_ENV: Record<
  string,
  { label: string; env: string[]; orderSync: boolean; metricsSync: boolean; note?: string }
> = {
  etsy: {
    label: "Etsy",
    env: ["ETSY_CLIENT_ID", "ETSY_CLIENT_SECRET", "ETSY_REFRESH_TOKEN", "ETSY_SHOP_ID"],
    orderSync: true,
    metricsSync: true,
  },
  shopify: {
    label: "Shopify",
    env: ["SHOPIFY_STORE_URL", "SHOPIFY_ACCESS_TOKEN"],
    orderSync: true,
    metricsSync: false,
    note: "Free listings. View metrics unavailable on Shopify Basic.",
  },
  tiktok: {
    label: "TikTok Shop",
    env: ["TIKTOK_SHOP_APP_KEY", "TIKTOK_SHOP_APP_SECRET", "TIKTOK_SHOP_ACCESS_TOKEN"],
    orderSync: false,
    metricsSync: false,
    note: "Publishing works; order/metrics sync not yet implemented.",
  },
  amazon: {
    label: "Amazon (SP-API)",
    env: ["AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET", "AMAZON_REFRESH_TOKEN", "AMAZON_SELLER_ID"],
    orderSync: false,
    metricsSync: false,
    note: "$0.99 per-listing fee. Order/metrics sync not yet implemented.",
  },
  depop: {
    label: "Depop",
    env: ["DEPOP_ACCESS_TOKEN"],
    orderSync: false,
    metricsSync: false,
    note: "Title cannot be updated after publish. No order/metrics sync.",
  },
  redbubble: {
    label: "Redbubble",
    env: ["REDBUBBLE_API_KEY", "REDBUBBLE_ACCOUNT_ID"],
    orderSync: false,
    metricsSync: false,
    note: "Price/title immutable after publish. No order/metrics sync.",
  },
};

/** Full readiness incl. which env vars are missing. For authenticated surfaces only. */
export function getPlatformReadiness(): PlatformReadiness[] {
  return Object.entries(PLATFORM_ENV).map(([id, cfg]) => {
    const missingEnv = cfg.env.filter((v) => !process.env[v]);
    const configured = missingEnv.length === 0;
    return {
      id,
      label: cfg.label,
      configured,
      missingEnv,
      capabilities: { publish: configured, orderSync: cfg.orderSync, metricsSync: cfg.metricsSync },
      note: cfg.note,
    };
  });
}

/** Name-free summary (configured booleans only) safe for unauthenticated surfaces. */
export function getPlatformReadinessSummary(): Record<string, boolean> {
  return Object.fromEntries(getPlatformReadiness().map((p) => [p.id, p.configured]));
}

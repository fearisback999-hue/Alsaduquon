import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ============================================================
// PIPELINE ORCHESTRATION
// ============================================================

export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  status: text("status", { enum: ["pending", "running", "completed", "failed", "paused"] }).notNull().default("pending"),
  currentStep: integer("current_step").notNull().default(1),
  currentStepName: text("current_step_name").default("research"),
  error: text("error"),
  nichesProcessed: integer("niches_processed").default(0),
  listingsPublished: integer("listings_published").default(0),
  totalCost: real("total_cost").default(0),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  statusIdx: index("pipeline_runs_status_idx").on(table.status),
}));

export const pipelineStepLogs = sqliteTable("pipeline_step_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  pipelineRunId: text("pipeline_run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  stepName: text("step_name").notNull(),
  status: text("status", { enum: ["started", "completed", "failed", "skipped"] }).notNull(),
  error: text("error"),
  durationMs: integer("duration_ms"),
  inputSummary: text("input_summary"),
  outputSummary: text("output_summary"),
  cost: real("cost").default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  runIdx: index("step_logs_run_idx").on(table.pipelineRunId, table.stepNumber),
}));

// ============================================================
// STEP 1 & 2: NICHE RESEARCH + SCORING
// ============================================================

export const niches = sqliteTable("niches", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  source: text("source", { enum: ["podcs", "flying_research", "etsy_trends", "ai_expansion", "micro_drill", "manual"] }),
  status: text("status", { enum: ["discovered", "scored", "approved", "rejected", "active", "exhausted", "saturated"] }).notNull().default("discovered"),

  // Raw trend data (step 1)
  searchVolume: integer("search_volume"),
  competitionLevel: real("competition_level"),
  salesVelocity: real("sales_velocity"),
  seasonalityScore: real("seasonality_score"),
  trendingScore: real("trending_score"),
  trendDirection: text("trend_direction"),
  // Buyer-persona metadata (populated for source="micro_drill")
  buyerPersona: text("buyer_persona"),
  occasion: text("occasion"),
  style: text("style"),
  rawTrendData: text("raw_trend_data"), // JSON

  // Scoring (step 2)
  compositeScore: real("composite_score"),
  scoreBreakdown: text("score_breakdown"), // JSON
  passedThreshold: integer("passed_threshold", { mode: "boolean" }).default(false),

  // Demand velocity (computed from niche_velocity_snapshots)
  velocityScore: real("velocity_score"), // computed score 0-10
  weekOverWeekGrowth: real("week_over_week_growth"), // percentage change
  accelerationDetected: integer("acceleration_detected", { mode: "boolean" }).default(false),
  lastVelocityCheck: text("last_velocity_check"),

  // Cross-platform demand triangulation (computed from multiple platforms)
  triangulationScore: real("triangulation_score"), // 0-100
  platformsPresent: integer("platforms_present"), // how many platforms show signal
  crossPlatformData: text("cross_platform_data"), // JSON

  pipelineRunId: text("pipeline_run_id").references(() => pipelineRuns.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  statusIdx: index("niches_status_idx").on(table.status),
  scoreIdx: index("niches_score_idx").on(table.compositeScore),
  nameIdx: uniqueIndex("niches_name_idx").on(table.name),
}));

export const nicheVelocitySnapshots = sqliteTable("niche_velocity_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  nicheId: text("niche_id").notNull().references(() => niches.id, { onDelete: "cascade" }),
  searchVolume: integer("search_volume"),
  etsyListingCount: integer("etsy_listing_count"),
  etsyAvgFavorites: real("etsy_avg_favorites"),
  etsyTopFavorites: integer("etsy_top_favorites"), // peak favorites of top listing
  googleTrendsScore: integer("google_trends_score"), // 0-100
  pinterestSaves: integer("pinterest_saves"),
  snapshotDate: text("snapshot_date").notNull(), // YYYY-MM-DD
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  nicheSnapshotIdx: index("niche_velocity_niche_idx").on(table.nicheId, table.snapshotDate),
  dateIdx: index("niche_velocity_date_idx").on(table.snapshotDate),
}));

// ============================================================
// STEP 3: DESIGN CONCEPTS (5 per niche)
// ============================================================

export const designConcepts = sqliteTable("design_concepts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  nicheId: text("niche_id").notNull().references(() => niches.id, { onDelete: "cascade" }),
  conceptNumber: integer("concept_number").notNull(), // 1-5
  title: text("title").notNull(),
  description: text("description"),
  stylePrompt: text("style_prompt"), // DALL-E prompt
  targetAudience: text("target_audience"),
  colorPalette: text("color_palette"), // JSON array
  designType: text("design_type", { enum: ["typography", "illustration", "hybrid", "pattern"] }).default("hybrid"),
  status: text("status", { enum: ["pending", "moderated", "approved", "rejected", "generating", "generated", "failed"] }).notNull().default("pending"),
  moderationResult: text("moderation_result"), // JSON from OpenAI moderation
  pipelineRunId: text("pipeline_run_id").references(() => pipelineRuns.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  nicheIdx: index("concepts_niche_idx").on(table.nicheId),
  statusIdx: index("concepts_status_idx").on(table.status),
}));

// ============================================================
// STEP 4: AI IMAGE GENERATION
// ============================================================

export const generatedImages = sqliteTable("generated_images", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  designConceptId: text("design_concept_id").notNull().references(() => designConcepts.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  revisedPrompt: text("revised_prompt"), // DALL-E sometimes revises
  originalUrl: text("original_url"), // Temporary DALL-E URL (expires)
  storagePath: text("storage_path"), // Permanent Vercel Blob path
  storageUrl: text("storage_url"), // Permanent Vercel Blob URL
  model: text("model").notNull().default("dall-e-3"),
  size: text("size").default("1024x1024"),
  quality: text("quality").default("hd"),
  attempt: integer("attempt").notNull().default(1), // 1-3
  maxAttempts: integer("max_attempts").notNull().default(3),
  status: text("status", { enum: ["pending", "generating", "generated", "failed", "validated", "rejected"] }).notNull().default("pending"),
  errorMessage: text("error_message"),
  qualityScores: text("quality_scores"), // JSON: { composition, text_legibility, print_suitability, commercial_appeal, technical_quality, overall_score }
  pipelineRunId: text("pipeline_run_id").references(() => pipelineRuns.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  conceptIdx: index("images_concept_idx").on(table.designConceptId),
  statusIdx: index("images_status_idx").on(table.status),
}));

// ============================================================
// STEP 5: DESIGN VALIDATION
// ============================================================

export const designValidations = sqliteTable("design_validations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  generatedImageId: text("generated_image_id").notNull().references(() => generatedImages.id, { onDelete: "cascade" }),
  width: integer("width"),
  height: integer("height"),
  dpiValue: integer("dpi_value"),
  format: text("format"),
  colorMode: text("color_mode"),
  fileSizeBytes: integer("file_size_bytes"),
  dimensionsPass: integer("dimensions_pass", { mode: "boolean" }).default(false),
  dpiPass: integer("dpi_pass", { mode: "boolean" }).default(false),
  formatPass: integer("format_pass", { mode: "boolean" }).default(false),
  colorModePass: integer("color_mode_pass", { mode: "boolean" }).default(false),
  fileSizePass: integer("file_size_pass", { mode: "boolean" }).default(false),
  overallPass: integer("overall_pass", { mode: "boolean" }).default(false),
  failureReasons: text("failure_reasons"), // JSON array
  validatedAt: text("validated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ============================================================
// STEP 6: PRINTIFY PRODUCTS
// ============================================================

export const printifyProducts = sqliteTable("printify_products", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  designConceptId: text("design_concept_id").notNull().references(() => designConcepts.id, { onDelete: "cascade" }),
  generatedImageId: text("generated_image_id").notNull().references(() => generatedImages.id),
  printifyProductId: text("printify_product_id"), // External Printify ID
  printifyShopId: text("printify_shop_id"),
  productType: text("product_type").notNull(),
  blueprintId: integer("blueprint_id"),
  printProviderId: integer("print_provider_id"),
  title: text("title").notNull(),
  description: text("description"),
  baseCost: real("base_cost"),
  retailPrice: real("retail_price"),
  variants: text("variants"), // JSON: color/size combos
  status: text("status", { enum: ["pending", "creating", "created", "failed", "published"] }).notNull().default("pending"),
  printifyData: text("printify_data"), // JSON: full API response
  pipelineRunId: text("pipeline_run_id").references(() => pipelineRuns.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  conceptIdx: index("products_concept_idx").on(table.designConceptId),
  typeIdx: index("products_type_idx").on(table.productType),
  statusIdx: index("products_status_idx").on(table.status),
  printifyIdx: index("products_printify_idx").on(table.printifyProductId),
}));

// ============================================================
// STEP 7: MOCKUPS
// ============================================================

export const mockups = sqliteTable("mockups", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  printifyProductId: text("printify_product_id").notNull().references(() => printifyProducts.id, { onDelete: "cascade" }),
  originalUrl: text("original_url"), // Printify URL
  storageUrl: text("storage_url"), // Permanent Vercel Blob URL
  mockupType: text("mockup_type", { enum: ["front", "back", "side", "lifestyle", "closeup", "size_chart"] }),
  variantLabel: text("variant_label"),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
  status: text("status", { enum: ["pending", "fetched", "stored", "failed"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  productIdx: index("mockups_product_idx").on(table.printifyProductId),
}));

// ============================================================
// STEP 8: LISTINGS (multi-platform)
// ============================================================

export const listings = sqliteTable("listings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  platform: text("platform", { enum: ["etsy", "shopify", "tiktok", "depop", "redbubble", "amazon"] }).notNull().default("etsy"),
  printifyProductId: text("printify_product_id").references(() => printifyProducts.id, { onDelete: "cascade" }),
  externalListingId: text("external_listing_id"),
  title: text("title").notNull(),
  titleVariants: text("title_variants"), // JSON array of variant titles for A/B rotation
  titleVariantIndex: integer("title_variant_index").default(0),
  titleVariantRotatedAt: text("title_variant_rotated_at"),
  descriptionVariants: text("description_variants"), // JSON array of variant descriptions
  descriptionVariantIndex: integer("description_variant_index").default(0),
  tagVariants: text("tag_variants"), // JSON array of variant tag arrays (array of arrays)
  tagVariantIndex: integer("tag_variant_index").default(0),
  description: text("description").notNull(),
  tags: text("tags").notNull(), // JSON array
  materials: text("materials"), // JSON array
  seoScore: real("seo_score"),
  basePrice: real("base_price").notNull().default(25),
  marginPercent: real("margin_percent").notNull().default(40),
  finalPrice: real("final_price").notNull().default(35),
  shippingPrice: real("shipping_price").default(0),
  externalState: text("external_state").default("draft"),
  externalUrl: text("external_url"),
  status: text("status", { enum: ["draft", "pending_approval", "approved", "rejected", "published", "deactivated"] }).notNull().default("draft"),
  moderationResult: text("moderation_result"), // JSON
  pipelineRunId: text("pipeline_run_id").references(() => pipelineRuns.id),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  statusIdx: index("listings_v2_status_idx").on(table.status),
  platformIdx: index("listings_v2_platform_idx").on(table.platform),
  externalIdx: index("listings_v2_external_idx").on(table.platform, table.externalListingId),
  productIdx: index("listings_v2_product_idx").on(table.printifyProductId),
}));

// ============================================================
// STEP 9: APPROVAL QUEUE
// ============================================================

export const approvalQueueEntries = sqliteTable("approval_queue_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  batchNumber: integer("batch_number"),
  batchOrder: integer("batch_order"),
  mode: text("mode", { enum: ["manual", "auto"] }).notNull().default("manual"),
  status: text("status", { enum: ["pending", "approved", "rejected", "revision_requested", "published"] }).notNull().default("pending"),
  feedback: text("feedback"),
  revisionNotes: text("revision_notes"),
  autoScore: real("auto_score"),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  batchIdx: index("approval_batch_idx").on(table.batchNumber),
  statusIdx: index("approval_status_idx").on(table.status),
}));

// ============================================================
// STEP 10: ORDERS
// ============================================================

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  listingId: text("listing_id").notNull().references(() => listings.id),
  platform: text("platform", { enum: ["etsy", "shopify", "tiktok", "depop", "redbubble", "amazon"] }).notNull().default("etsy"),
  externalOrderId: text("external_order_id"),
  printifyOrderId: text("printify_order_id"),
  externalData: text("external_data"), // JSON: platform-specific order data
  customerRegion: text("customer_region"),
  status: text("status", { enum: ["new", "processing", "shipped", "delivered", "cancelled", "refunded"] }).notNull().default("new"),
  quantity: integer("quantity").notNull().default(1),
  revenue: real("revenue").notNull(),
  cost: real("cost"),
  profit: real("profit"),
  shippingCarrier: text("shipping_carrier"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  orderedAt: text("ordered_at"),
  shippedAt: text("shipped_at"),
  deliveredAt: text("delivered_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  externalIdx: uniqueIndex("orders_external_idx").on(table.platform, table.externalOrderId),
  statusIdx: index("orders_status_idx").on(table.status),
  listingIdx: index("orders_listing_idx").on(table.listingId),
}));

// ============================================================
// COST TRACKING
// ============================================================

export const dailyCosts = sqliteTable("daily_costs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  date: text("date").notNull(), // YYYY-MM-DD
  totalCost: real("total_cost").notNull().default(0),
  aiCost: real("ai_cost").notNull().default(0),
  apiCost: real("api_cost").notNull().default(0),
  listingFees: real("listing_fees").notNull().default(0),
  listingsCreated: integer("listings_created").notNull().default(0),
  maxDailyCost: real("max_daily_cost").notNull().default(50),
  maxDailyListings: integer("max_daily_listings").notNull().default(25),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  dateIdx: uniqueIndex("daily_costs_date_idx").on(table.date),
}));

export const costEntries = sqliteTable("cost_entries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  date: text("date").notNull(), // YYYY-MM-DD
  category: text("category", { enum: ["openai_text", "openai_image", "openai_moderation", "anthropic_text", "replicate_image", "printify", "etsy_fee", "shopify_fee", "tiktok_fee", "depop_fee", "redbubble_fee", "amazon_fee", "trend_api", "other"] }).notNull(),
  modelName: text("model_name"),
  amount: real("amount").notNull(),
  description: text("description"),
  referenceId: text("reference_id"),
  referenceType: text("reference_type"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  dateIdx: index("cost_entries_date_idx").on(table.date),
  categoryIdx: index("cost_entries_category_idx").on(table.category),
}));

// ============================================================
// TOKEN USAGE TRACKING
// ============================================================

export const tokenUsages = sqliteTable("token_usages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  modelName: text("model_name").notNull(),
  operation: text("operation").notNull(), // niche_research, scoring, concept_gen, image_gen, seo_gen, moderation
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCost: real("estimated_cost").notNull().default(0),
  durationMs: integer("duration_ms"),
  pipelineRunId: text("pipeline_run_id").references(() => pipelineRuns.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  modelIdx: index("token_model_idx").on(table.modelName),
  operationIdx: index("token_operation_idx").on(table.operation),
}));

// ============================================================
// ANALYTICS
// ============================================================

export const nicheAnalytics = sqliteTable("niche_analytics", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  nicheId: text("niche_id").notNull().references(() => niches.id, { onDelete: "cascade" }),
  totalDesigns: integer("total_designs").default(0),
  totalListings: integer("total_listings").default(0),
  totalOrders: integer("total_orders").default(0),
  totalRevenue: real("total_revenue").default(0),
  totalProfit: real("total_profit").default(0),
  totalCost: real("total_cost").default(0),
  nicheHitRate: real("niche_hit_rate"), // orders / listings
  approvalToSale: real("approval_to_sale"),
  avgOrderValue: real("avg_order_value"),
  costPerListing: real("cost_per_listing"),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  nicheIdx: uniqueIndex("niche_analytics_niche_idx").on(table.nicheId),
}));

export const dailyAnalytics = sqliteTable("daily_analytics", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  date: text("date").notNull(), // YYYY-MM-DD
  nichesResearched: integer("niches_researched").default(0),
  nichesApproved: integer("niches_approved").default(0),
  conceptsCreated: integer("concepts_created").default(0),
  imagesGenerated: integer("images_generated").default(0),
  imagesValidated: integer("images_validated").default(0),
  productsCreated: integer("products_created").default(0),
  listingsDrafted: integer("listings_drafted").default(0),
  listingsApproved: integer("listings_approved").default(0),
  listingsPublished: integer("listings_published").default(0),
  ordersReceived: integer("orders_received").default(0),
  totalRevenue: real("total_revenue").default(0),
  totalCost: real("total_cost").default(0),
  totalProfit: real("total_profit").default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  dateIdx: uniqueIndex("daily_analytics_date_idx").on(table.date),
}));

// ============================================================
// LISTING PERFORMANCE METRICS
// ============================================================

export const listingMetrics = sqliteTable("listing_metrics", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
  views: integer("views").notNull().default(0),
  favorites: integer("favorites").notNull().default(0),
  sales: integer("sales").notNull().default(0),
  conversionRate: real("conversion_rate"), // sales / views
  revenue: real("revenue").default(0),
  syncedAt: text("synced_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  listingIdx: uniqueIndex("listing_metrics_listing_idx").on(table.listingId),
}));

// ============================================================
// COMPETITOR PRICING
// ============================================================

export const competitorPricing = sqliteTable("competitor_pricing", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  nicheId: text("niche_id").notNull().references(() => niches.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["etsy", "shopify", "tiktok", "depop", "redbubble", "amazon"] }).notNull().default("etsy"),
  externalListingId: text("external_listing_id"),
  title: text("title"),
  price: real("price").notNull(),
  currency: text("currency").default("USD"),
  favorites: integer("favorites").default(0),
  sales: integer("sales").default(0),
  sellerName: text("seller_name"),
  scrapedAt: text("scraped_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  nicheIdx: index("competitor_niche_idx").on(table.nicheId),
  scrapedIdx: index("competitor_scraped_idx").on(table.scrapedAt),
}));

// ============================================================
// CUSTOMER REVIEWS
// ============================================================

export const customerReviews = sqliteTable("customer_reviews", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  listingId: text("listing_id").references(() => listings.id),
  platform: text("platform").notNull().default("etsy"),
  externalReviewId: text("external_review_id"),
  rating: integer("rating").notNull(),
  reviewText: text("review_text"),
  sentiment: text("sentiment", { enum: ["positive", "neutral", "negative", "flagged"] }),
  qualityIssue: integer("quality_issue", { mode: "boolean" }).default(false),
  issueType: text("issue_type"), // "print_quality", "sizing", "color_mismatch", "shipping_damage"
  syncedAt: text("synced_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  listingIdx: index("reviews_listing_idx").on(table.listingId),
  ratingIdx: index("reviews_rating_idx").on(table.rating),
  sentimentIdx: index("reviews_sentiment_idx").on(table.sentiment),
}));

// ============================================================
// AUTH SESSIONS
// ============================================================

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  ip: text("ip"),
  userAgent: text("user_agent"),
}, (table) => ({
  expiresIdx: index("sessions_expires_idx").on(table.expiresAt),
}));

export const loginAttempts = sqliteTable("login_attempts", {
  ip: text("ip").primaryKey(),
  count: integer("count").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at").notNull(),
}, (table) => ({
  lastAttemptIdx: index("login_attempts_last_attempt_idx").on(table.lastAttemptAt),
}));

// ============================================================
// SETTINGS (key-value config)
// ============================================================

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text("key").notNull(),
  value: text("value").notNull(),
  type: text("type", { enum: ["string", "number", "boolean", "json"] }).notNull().default("string"),
  group: text("group", { enum: ["general", "pipeline", "pricing", "limits", "api"] }).notNull().default("general"),
  description: text("description"),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  keyIdx: uniqueIndex("settings_key_idx").on(table.key),
  groupIdx: index("settings_group_idx").on(table.group),
}));

// ============================================================
// NICHE LEARNING WEIGHTS (closed-loop learning from sales outcomes)
// ============================================================

export const nicheLearningWeights = sqliteTable("niche_learning_weights", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  metric: text("metric").notNull(), // search_volume, competition, sales_velocity, seasonality, trending, velocity, triangulation
  weight: real("weight").notNull(), // current weight applied
  correlation: real("correlation"), // -1 to 1, correlation with order outcome
  sampleSize: integer("sample_size").notNull(),
  lastTrainedAt: text("last_trained_at").notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  metricIdx: uniqueIndex("learning_weights_metric_idx").on(table.metric),
}));

// ============================================================
// RELATIONS
// ============================================================

export const pipelineRunsRelations = relations(pipelineRuns, ({ many }) => ({
  stepLogs: many(pipelineStepLogs),
  niches: many(niches),
}));

export const pipelineStepLogsRelations = relations(pipelineStepLogs, ({ one }) => ({
  pipelineRun: one(pipelineRuns, { fields: [pipelineStepLogs.pipelineRunId], references: [pipelineRuns.id] }),
}));

export const nichesRelations = relations(niches, ({ many, one }) => ({
  designConcepts: many(designConcepts),
  competitorPricings: many(competitorPricing),
  velocitySnapshots: many(nicheVelocitySnapshots),
  pipelineRun: one(pipelineRuns, { fields: [niches.pipelineRunId], references: [pipelineRuns.id] }),
  analytics: one(nicheAnalytics, { fields: [niches.id], references: [nicheAnalytics.nicheId] }),
}));

export const nicheVelocitySnapshotsRelations = relations(nicheVelocitySnapshots, ({ one }) => ({
  niche: one(niches, { fields: [nicheVelocitySnapshots.nicheId], references: [niches.id] }),
}));

export const competitorPricingRelations = relations(competitorPricing, ({ one }) => ({
  niche: one(niches, { fields: [competitorPricing.nicheId], references: [niches.id] }),
}));

export const designConceptsRelations = relations(designConcepts, ({ one, many }) => ({
  niche: one(niches, { fields: [designConcepts.nicheId], references: [niches.id] }),
  images: many(generatedImages),
  products: many(printifyProducts),
}));

export const generatedImagesRelations = relations(generatedImages, ({ one }) => ({
  designConcept: one(designConcepts, { fields: [generatedImages.designConceptId], references: [designConcepts.id] }),
  validation: one(designValidations, { fields: [generatedImages.id], references: [designValidations.generatedImageId] }),
}));

export const designValidationsRelations = relations(designValidations, ({ one }) => ({
  generatedImage: one(generatedImages, { fields: [designValidations.generatedImageId], references: [generatedImages.id] }),
}));

export const printifyProductsRelations = relations(printifyProducts, ({ one, many }) => ({
  designConcept: one(designConcepts, { fields: [printifyProducts.designConceptId], references: [designConcepts.id] }),
  generatedImage: one(generatedImages, { fields: [printifyProducts.generatedImageId], references: [generatedImages.id] }),
  mockups: many(mockups),
  listings: many(listings),
}));

export const mockupsRelations = relations(mockups, ({ one }) => ({
  product: one(printifyProducts, { fields: [mockups.printifyProductId], references: [printifyProducts.id] }),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  product: one(printifyProducts, { fields: [listings.printifyProductId], references: [printifyProducts.id] }),
  approvalEntry: one(approvalQueueEntries),
  orders: many(orders),
  metrics: one(listingMetrics),
  reviews: many(customerReviews),
}));

export const customerReviewsRelations = relations(customerReviews, ({ one }) => ({
  listing: one(listings, { fields: [customerReviews.listingId], references: [listings.id] }),
}));

export const listingMetricsRelations = relations(listingMetrics, ({ one }) => ({
  listing: one(listings, { fields: [listingMetrics.listingId], references: [listings.id] }),
}));

export const approvalQueueEntriesRelations = relations(approvalQueueEntries, ({ one }) => ({
  listing: one(listings, { fields: [approvalQueueEntries.listingId], references: [listings.id] }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  listing: one(listings, { fields: [orders.listingId], references: [listings.id] }),
}));

-- Migration: Create missing tables and add missing columns
-- Tables: niche_velocity_snapshots, competitor_pricing, customer_reviews, niche_learning_weights
-- Columns: listings A/B variant columns (description/tag variants)

CREATE TABLE IF NOT EXISTS `niche_velocity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`niche_id` text NOT NULL REFERENCES `niches`(`id`) ON DELETE CASCADE,
	`search_volume` integer,
	`etsy_listing_count` integer,
	`etsy_avg_favorites` real,
	`etsy_top_favorites` integer,
	`google_trends_score` integer,
	`pinterest_saves` integer,
	`snapshot_date` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `niche_velocity_niche_idx` ON `niche_velocity_snapshots` (`niche_id`, `snapshot_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `niche_velocity_date_idx` ON `niche_velocity_snapshots` (`snapshot_date`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `competitor_pricing` (
	`id` text PRIMARY KEY NOT NULL,
	`niche_id` text NOT NULL REFERENCES `niches`(`id`) ON DELETE CASCADE,
	`platform` text NOT NULL DEFAULT 'etsy',
	`external_listing_id` text,
	`title` text,
	`price` real NOT NULL,
	`currency` text DEFAULT 'USD',
	`favorites` integer DEFAULT 0,
	`sales` integer DEFAULT 0,
	`seller_name` text,
	`scraped_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `competitor_niche_idx` ON `competitor_pricing` (`niche_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `competitor_scraped_idx` ON `competitor_pricing` (`scraped_at`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `customer_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text REFERENCES `listings`(`id`),
	`platform` text NOT NULL DEFAULT 'etsy',
	`external_review_id` text,
	`rating` integer NOT NULL,
	`review_text` text,
	`sentiment` text DEFAULT 'neutral',
	`quality_issue` integer DEFAULT 0,
	`issue_type` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reviews_listing_idx` ON `customer_reviews` (`listing_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reviews_rating_idx` ON `customer_reviews` (`rating`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reviews_sentiment_idx` ON `customer_reviews` (`sentiment`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `niche_learning_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`metric` text NOT NULL,
	`weight` real NOT NULL,
	`correlation` real,
	`sample_size` integer NOT NULL,
	`last_trained_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `learning_weights_metric_idx` ON `niche_learning_weights` (`metric`);
--> statement-breakpoint

-- Niches: micro-niche persona metadata
ALTER TABLE `niches` ADD COLUMN `buyer_persona` text;
--> statement-breakpoint
ALTER TABLE `niches` ADD COLUMN `occasion` text;
--> statement-breakpoint
ALTER TABLE `niches` ADD COLUMN `style` text;
--> statement-breakpoint

-- Niches: demand velocity columns
ALTER TABLE `niches` ADD COLUMN `velocity_score` real;
--> statement-breakpoint
ALTER TABLE `niches` ADD COLUMN `week_over_week_growth` real;
--> statement-breakpoint
ALTER TABLE `niches` ADD COLUMN `acceleration_detected` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `niches` ADD COLUMN `last_velocity_check` text;
--> statement-breakpoint

-- Niches: cross-platform triangulation columns
ALTER TABLE `niches` ADD COLUMN `triangulation_score` real;
--> statement-breakpoint
ALTER TABLE `niches` ADD COLUMN `platforms_present` integer;
--> statement-breakpoint
ALTER TABLE `niches` ADD COLUMN `cross_platform_data` text;
--> statement-breakpoint

-- A/B variant columns for listings (may already exist from 0005)
ALTER TABLE `listings` ADD COLUMN `title_variant_index` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `listings` ADD COLUMN `title_variant_rotated_at` text;
--> statement-breakpoint
ALTER TABLE `listings` ADD COLUMN `description_variants` text;
--> statement-breakpoint
ALTER TABLE `listings` ADD COLUMN `description_variant_index` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `listings` ADD COLUMN `tag_variants` text;
--> statement-breakpoint
ALTER TABLE `listings` ADD COLUMN `tag_variant_index` integer DEFAULT 0;

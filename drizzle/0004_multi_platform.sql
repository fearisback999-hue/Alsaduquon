-- Migration: Multi-platform support
-- Rename etsy_listings → listings, generalize Etsy-specific columns

-- 1. Create the new `listings` table
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text DEFAULT 'etsy' NOT NULL,
	`printify_product_id` text,
	`external_listing_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`materials` text,
	`seo_score` real,
	`base_price` real DEFAULT 25 NOT NULL,
	`margin_percent` real DEFAULT 40 NOT NULL,
	`final_price` real DEFAULT 35 NOT NULL,
	`shipping_price` real DEFAULT 0,
	`external_state` text DEFAULT 'draft',
	`external_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`moderation_result` text,
	`pipeline_run_id` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `listings_v2_status_idx` ON `listings` (`status`);
--> statement-breakpoint
CREATE INDEX `listings_v2_platform_idx` ON `listings` (`platform`);
--> statement-breakpoint
CREATE INDEX `listings_v2_external_idx` ON `listings` (`platform`, `external_listing_id`);
--> statement-breakpoint
CREATE INDEX `listings_v2_product_idx` ON `listings` (`printify_product_id`);
--> statement-breakpoint

-- 2. Copy data from etsy_listings → listings
INSERT INTO `listings` (
	`id`, `platform`, `printify_product_id`, `external_listing_id`,
	`title`, `description`, `tags`, `materials`, `seo_score`,
	`base_price`, `margin_percent`, `final_price`, `shipping_price`,
	`external_state`, `external_url`, `status`, `moderation_result`,
	`pipeline_run_id`, `published_at`, `created_at`, `updated_at`
)
SELECT
	`id`, 'etsy', `printify_product_id`, `etsy_listing_id`,
	`title`, `description`, `tags`, `materials`, `seo_score`,
	`base_price`, `margin_percent`, `final_price`, `shipping_price`,
	`etsy_state`, `etsy_url`, `status`, `moderation_result`,
	`pipeline_run_id`, `published_at`, `created_at`, `updated_at`
FROM `etsy_listings`;
--> statement-breakpoint

-- 3. Drop old etsy_listings indexes and table
DROP INDEX `listings_status_idx`;
--> statement-breakpoint
DROP INDEX `listings_etsy_idx`;
--> statement-breakpoint
DROP INDEX `listings_product_idx`;
--> statement-breakpoint
DROP TABLE `etsy_listings`;
--> statement-breakpoint

-- 4. Recreate approval_queue_entries with listing_id instead of etsy_listing_id
CREATE TABLE `approval_queue_entries_new` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`batch_number` integer,
	`batch_order` integer,
	`mode` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`feedback` text,
	`revision_notes` text,
	`auto_score` real,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `approval_queue_entries_new` (
	`id`, `listing_id`, `batch_number`, `batch_order`, `mode`, `status`,
	`feedback`, `revision_notes`, `auto_score`, `reviewed_at`,
	`created_at`, `updated_at`
)
SELECT
	`id`, `etsy_listing_id`, `batch_number`, `batch_order`, `mode`, `status`,
	`feedback`, `revision_notes`, `auto_score`, `reviewed_at`,
	`created_at`, `updated_at`
FROM `approval_queue_entries`;
--> statement-breakpoint
DROP INDEX `approval_batch_idx`;
--> statement-breakpoint
DROP INDEX `approval_status_idx`;
--> statement-breakpoint
DROP TABLE `approval_queue_entries`;
--> statement-breakpoint
ALTER TABLE `approval_queue_entries_new` RENAME TO `approval_queue_entries`;
--> statement-breakpoint
CREATE INDEX `approval_batch_idx` ON `approval_queue_entries` (`batch_number`);
--> statement-breakpoint
CREATE INDEX `approval_status_idx` ON `approval_queue_entries` (`status`);
--> statement-breakpoint

-- 5. Recreate orders with listing_id, external_order_id, platform, external_data
CREATE TABLE `orders_new` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`platform` text DEFAULT 'etsy',
	`external_order_id` text,
	`printify_order_id` text,
	`external_data` text,
	`customer_region` text,
	`status` text DEFAULT 'new' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`revenue` real NOT NULL,
	`cost` real,
	`profit` real,
	`shipping_carrier` text,
	`tracking_number` text,
	`tracking_url` text,
	`ordered_at` text,
	`shipped_at` text,
	`delivered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `orders_new` (
	`id`, `listing_id`, `platform`, `external_order_id`, `printify_order_id`,
	`customer_region`, `status`, `quantity`, `revenue`, `cost`, `profit`,
	`shipping_carrier`, `tracking_number`, `tracking_url`,
	`ordered_at`, `shipped_at`, `delivered_at`, `created_at`, `updated_at`
)
SELECT
	`id`, `etsy_listing_id`, 'etsy', `etsy_order_id`, `printify_order_id`,
	`customer_region`, `status`, `quantity`, `revenue`, `cost`, `profit`,
	`shipping_carrier`, `tracking_number`, `tracking_url`,
	`ordered_at`, `shipped_at`, `delivered_at`, `created_at`, `updated_at`
FROM `orders`;
--> statement-breakpoint
DROP INDEX `orders_etsy_idx`;
--> statement-breakpoint
DROP INDEX `orders_status_idx`;
--> statement-breakpoint
DROP TABLE `orders`;
--> statement-breakpoint
ALTER TABLE `orders_new` RENAME TO `orders`;
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_external_idx` ON `orders` (`platform`, `external_order_id`);
--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);
--> statement-breakpoint
CREATE INDEX `orders_listing_idx` ON `orders` (`listing_id`);
--> statement-breakpoint

-- 6. Recreate listing_metrics with listing_id instead of etsy_listing_id
CREATE TABLE `listing_metrics_new` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`favorites` integer DEFAULT 0 NOT NULL,
	`sales` integer DEFAULT 0 NOT NULL,
	`conversion_rate` real,
	`revenue` real DEFAULT 0,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `listing_metrics_new` (
	`id`, `listing_id`, `views`, `favorites`, `sales`,
	`conversion_rate`, `revenue`, `synced_at`
)
SELECT
	`id`, `etsy_listing_id`, `views`, `favorites`, `sales`,
	`conversion_rate`, `revenue`, `synced_at`
FROM `listing_metrics`;
--> statement-breakpoint
DROP INDEX `listing_metrics_listing_idx`;
--> statement-breakpoint
DROP TABLE `listing_metrics`;
--> statement-breakpoint
ALTER TABLE `listing_metrics_new` RENAME TO `listing_metrics`;
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_metrics_listing_idx` ON `listing_metrics` (`listing_id`);

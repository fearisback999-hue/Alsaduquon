CREATE TABLE `approval_queue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`etsy_listing_id` text NOT NULL,
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
	FOREIGN KEY (`etsy_listing_id`) REFERENCES `etsy_listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approval_batch_idx` ON `approval_queue_entries` (`batch_number`);--> statement-breakpoint
CREATE INDEX `approval_status_idx` ON `approval_queue_entries` (`status`);--> statement-breakpoint
CREATE TABLE `cost_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`model_name` text,
	`amount` real NOT NULL,
	`description` text,
	`reference_id` text,
	`reference_type` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cost_entries_date_idx` ON `cost_entries` (`date`);--> statement-breakpoint
CREATE INDEX `cost_entries_category_idx` ON `cost_entries` (`category`);--> statement-breakpoint
CREATE TABLE `daily_analytics` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`niches_researched` integer DEFAULT 0,
	`niches_approved` integer DEFAULT 0,
	`concepts_created` integer DEFAULT 0,
	`images_generated` integer DEFAULT 0,
	`images_validated` integer DEFAULT 0,
	`products_created` integer DEFAULT 0,
	`listings_drafted` integer DEFAULT 0,
	`listings_approved` integer DEFAULT 0,
	`listings_published` integer DEFAULT 0,
	`orders_received` integer DEFAULT 0,
	`total_revenue` real DEFAULT 0,
	`total_cost` real DEFAULT 0,
	`total_profit` real DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_analytics_date_idx` ON `daily_analytics` (`date`);--> statement-breakpoint
CREATE TABLE `daily_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`total_cost` real DEFAULT 0 NOT NULL,
	`ai_cost` real DEFAULT 0 NOT NULL,
	`api_cost` real DEFAULT 0 NOT NULL,
	`listing_fees` real DEFAULT 0 NOT NULL,
	`listings_created` integer DEFAULT 0 NOT NULL,
	`max_daily_cost` real DEFAULT 10 NOT NULL,
	`max_daily_listings` integer DEFAULT 5 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_costs_date_idx` ON `daily_costs` (`date`);--> statement-breakpoint
CREATE TABLE `design_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`niche_id` text NOT NULL,
	`concept_number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`style_prompt` text,
	`target_audience` text,
	`color_palette` text,
	`design_type` text DEFAULT 'hybrid',
	`status` text DEFAULT 'pending' NOT NULL,
	`moderation_result` text,
	`pipeline_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`niche_id`) REFERENCES `niches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `concepts_niche_idx` ON `design_concepts` (`niche_id`);--> statement-breakpoint
CREATE INDEX `concepts_status_idx` ON `design_concepts` (`status`);--> statement-breakpoint
CREATE TABLE `design_validations` (
	`id` text PRIMARY KEY NOT NULL,
	`generated_image_id` text NOT NULL,
	`width` integer,
	`height` integer,
	`dpi_value` integer,
	`format` text,
	`color_mode` text,
	`file_size_bytes` integer,
	`dimensions_pass` integer DEFAULT false,
	`dpi_pass` integer DEFAULT false,
	`format_pass` integer DEFAULT false,
	`color_mode_pass` integer DEFAULT false,
	`file_size_pass` integer DEFAULT false,
	`overall_pass` integer DEFAULT false,
	`failure_reasons` text,
	`validated_at` text NOT NULL,
	FOREIGN KEY (`generated_image_id`) REFERENCES `generated_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `etsy_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`printify_product_id` text NOT NULL,
	`etsy_listing_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`materials` text,
	`seo_score` real,
	`base_price` real DEFAULT 25 NOT NULL,
	`margin_percent` real DEFAULT 40 NOT NULL,
	`final_price` real DEFAULT 35 NOT NULL,
	`shipping_price` real DEFAULT 0,
	`etsy_state` text DEFAULT 'draft',
	`etsy_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`moderation_result` text,
	`pipeline_run_id` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printify_product_id`) REFERENCES `printify_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `listings_status_idx` ON `etsy_listings` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `listings_etsy_idx` ON `etsy_listings` (`etsy_listing_id`);--> statement-breakpoint
CREATE INDEX `listings_product_idx` ON `etsy_listings` (`printify_product_id`);--> statement-breakpoint
CREATE TABLE `generated_images` (
	`id` text PRIMARY KEY NOT NULL,
	`design_concept_id` text NOT NULL,
	`prompt` text NOT NULL,
	`revised_prompt` text,
	`original_url` text,
	`storage_path` text,
	`storage_url` text,
	`model` text DEFAULT 'dall-e-3' NOT NULL,
	`size` text DEFAULT '1024x1024',
	`quality` text DEFAULT 'hd',
	`attempt` integer DEFAULT 1 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`pipeline_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`design_concept_id`) REFERENCES `design_concepts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `images_concept_idx` ON `generated_images` (`design_concept_id`);--> statement-breakpoint
CREATE INDEX `images_status_idx` ON `generated_images` (`status`);--> statement-breakpoint
CREATE TABLE `mockups` (
	`id` text PRIMARY KEY NOT NULL,
	`printify_product_id` text NOT NULL,
	`original_url` text,
	`storage_url` text,
	`mockup_type` text,
	`variant_label` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT false,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`printify_product_id`) REFERENCES `printify_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mockups_product_idx` ON `mockups` (`printify_product_id`);--> statement-breakpoint
CREATE TABLE `niche_analytics` (
	`id` text PRIMARY KEY NOT NULL,
	`niche_id` text NOT NULL,
	`total_designs` integer DEFAULT 0,
	`total_listings` integer DEFAULT 0,
	`total_orders` integer DEFAULT 0,
	`total_revenue` real DEFAULT 0,
	`total_profit` real DEFAULT 0,
	`total_cost` real DEFAULT 0,
	`niche_hit_rate` real,
	`approval_to_sale` real,
	`avg_order_value` real,
	`cost_per_listing` real,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`niche_id`) REFERENCES `niches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `niche_analytics_niche_idx` ON `niche_analytics` (`niche_id`);--> statement-breakpoint
CREATE TABLE `niches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`description` text,
	`source` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`search_volume` integer,
	`competition_level` real,
	`sales_velocity` real,
	`seasonality_score` real,
	`trending_score` real,
	`trend_direction` text,
	`raw_trend_data` text,
	`composite_score` real,
	`score_breakdown` text,
	`passed_threshold` integer DEFAULT false,
	`pipeline_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `niches_status_idx` ON `niches` (`status`);--> statement-breakpoint
CREATE INDEX `niches_score_idx` ON `niches` (`composite_score`);--> statement-breakpoint
CREATE UNIQUE INDEX `niches_name_idx` ON `niches` (`name`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`etsy_listing_id` text NOT NULL,
	`etsy_order_id` text,
	`printify_order_id` text,
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
	FOREIGN KEY (`etsy_listing_id`) REFERENCES `etsy_listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_etsy_idx` ON `orders` (`etsy_order_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_step` integer DEFAULT 1 NOT NULL,
	`current_step_name` text DEFAULT 'research',
	`error` text,
	`niches_processed` integer DEFAULT 0,
	`listings_published` integer DEFAULT 0,
	`total_cost` real DEFAULT 0,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pipeline_runs_status_idx` ON `pipeline_runs` (`status`);--> statement-breakpoint
CREATE TABLE `pipeline_step_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_run_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`step_name` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`duration_ms` integer,
	`input_summary` text,
	`output_summary` text,
	`cost` real DEFAULT 0,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `step_logs_run_idx` ON `pipeline_step_logs` (`pipeline_run_id`,`step_number`);--> statement-breakpoint
CREATE TABLE `printify_products` (
	`id` text PRIMARY KEY NOT NULL,
	`design_concept_id` text NOT NULL,
	`generated_image_id` text NOT NULL,
	`printify_product_id` text,
	`printify_shop_id` text,
	`product_type` text NOT NULL,
	`blueprint_id` integer,
	`print_provider_id` integer,
	`title` text NOT NULL,
	`description` text,
	`base_cost` real,
	`retail_price` real,
	`variants` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`printify_data` text,
	`pipeline_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`design_concept_id`) REFERENCES `design_concepts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generated_image_id`) REFERENCES `generated_images`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_concept_idx` ON `printify_products` (`design_concept_id`);--> statement-breakpoint
CREATE INDEX `products_type_idx` ON `printify_products` (`product_type`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `printify_products` (`status`);--> statement-breakpoint
CREATE INDEX `products_printify_idx` ON `printify_products` (`printify_product_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`type` text DEFAULT 'string' NOT NULL,
	`group` text DEFAULT 'general' NOT NULL,
	`description` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_key_idx` ON `settings` (`key`);--> statement-breakpoint
CREATE INDEX `settings_group_idx` ON `settings` (`group`);--> statement-breakpoint
CREATE TABLE `token_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`model_name` text NOT NULL,
	`operation` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`pipeline_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `token_model_idx` ON `token_usages` (`model_name`);--> statement-breakpoint
CREATE INDEX `token_operation_idx` ON `token_usages` (`operation`);
CREATE TABLE `listing_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`etsy_listing_id` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`favorites` integer DEFAULT 0 NOT NULL,
	`sales` integer DEFAULT 0 NOT NULL,
	`conversion_rate` real,
	`revenue` real DEFAULT 0,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`etsy_listing_id`) REFERENCES `etsy_listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_metrics_listing_idx` ON `listing_metrics` (`etsy_listing_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ip` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);
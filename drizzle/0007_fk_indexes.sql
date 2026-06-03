-- Migration: add indexes on foreign keys used in WHERE/JOIN lookups.
-- These columns are queried during pipeline-run scoping, cleanup, resume,
-- the step-06 idempotency check (generated_image_id), and approval-queue
-- joins, but were unindexed — forcing full table scans that get linearly
-- slower as niches/images/products/listings accumulate.

CREATE INDEX IF NOT EXISTS `niches_run_idx` ON `niches` (`pipeline_run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `concepts_run_idx` ON `design_concepts` (`pipeline_run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `images_run_idx` ON `generated_images` (`pipeline_run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `products_image_idx` ON `printify_products` (`generated_image_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `products_run_idx` ON `printify_products` (`pipeline_run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `approval_listing_idx` ON `approval_queue_entries` (`listing_id`);

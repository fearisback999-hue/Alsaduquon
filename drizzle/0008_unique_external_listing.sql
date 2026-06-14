-- Migration: enforce uniqueness on (platform, external_listing_id) for listings.
-- A non-unique index previously allowed the same external marketplace listing
-- to be recorded twice (e.g. if a sync or a step-08 retry raced), which would
-- corrupt reconciliation and double-count analytics. external_listing_id is
-- NULL for drafts; SQLite treats NULLs as distinct, so multiple un-published
-- drafts on the same platform remain allowed — only real, published listing
-- IDs are de-duplicated. This mirrors the existing UNIQUE orders_external_idx.

DROP INDEX `listings_v2_external_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_v2_external_idx` ON `listings` (`platform`,`external_listing_id`);

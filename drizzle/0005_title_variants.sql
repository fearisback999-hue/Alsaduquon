-- Add A/B testing columns to listings:
-- title_variants: JSON array of generated title alternatives
-- title_variant_index: which variant is currently active (0-based)
-- title_variant_rotated_at: timestamp of last rotation, used by the
--   weekly rotation cron to decide when to advance.

ALTER TABLE listings ADD COLUMN title_variants TEXT;
ALTER TABLE listings ADD COLUMN title_variant_index INTEGER DEFAULT 0;
ALTER TABLE listings ADD COLUMN title_variant_rotated_at TEXT;

-- ============================================================
-- 04 — Add an icon name to categories
-- ============================================================
-- Categories previously only had an optional image_url meant for an uploaded
-- image file. The catalog UI renders each category with a Lucide icon (e.g.
-- 'Cigarette', 'CupSoda', 'Coffee'), so we store that icon name alongside the
-- category. It's a short identifier, not a URL, hence a separate column.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon VARCHAR(100);

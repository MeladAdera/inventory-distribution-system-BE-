-- ============================================================
-- 05 — Distinguish orderable warehouse stock from catalog-only templates
-- ============================================================
-- A WAREHOUSE product row is item-master data — it doesn't imply the
-- warehouse actually stocks it. Catalog-only entries (seeded so shops can
-- self-register a product name/category into their own inventory) were
-- indistinguishable from real, orderable warehouse stock, so the order
-- picker could offer products the warehouse never carries.
--
-- Defaults to TRUE so every existing/real product stays orderable with no
-- migration data-fix needed; catalog-only rows are seeded with FALSE.

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_orderable BOOLEAN NOT NULL DEFAULT TRUE;

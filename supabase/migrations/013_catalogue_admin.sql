-- ─── Feature flag: AI image generation per tenant ─────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_image_generation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.ai_image_generation IS
  'Enables AI-generated product images for this tenant (Gemini/Replicate integration)';

-- To enable for a specific tenant:
-- UPDATE tenants SET ai_image_generation = true WHERE slug = 'chloefood';

-- ─── Grants ────────────────────────────────────────────────────────────────
GRANT SELECT (ai_image_generation) ON tenants TO anon, authenticated;

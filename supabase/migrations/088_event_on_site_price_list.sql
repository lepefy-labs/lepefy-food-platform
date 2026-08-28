-- Event-specific price list displayed as an informational image on the public
-- event page. These prices are paid on site and are intentionally independent
-- from event_ticket_types / online reservation formulas.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS on_site_price_list_image_url text;

COMMENT ON COLUMN public.events.on_site_price_list_image_url IS
  'Optional image URL for informational food/drink prices paid on site; not an online-reservable formula.';

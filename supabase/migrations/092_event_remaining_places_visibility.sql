-- Allow each event to decide whether the exact remaining capacity is public.
-- Existing events preserve the current behavior by default.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS show_remaining_places boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.show_remaining_places IS
  'When true, public Events surfaces may display the exact number of remaining places. When false, they expose qualitative availability only.';

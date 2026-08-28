ALTER TABLE public.events ADD COLUMN IF NOT EXISTS booking_closes_at timestamptz;

ALTER TABLE public.events
  ADD CONSTRAINT events_booking_closes_before_start
  CHECK (booking_closes_at IS NULL OR booking_closes_at < date_start);

COMMENT ON COLUMN public.events.booking_closes_at IS 'Optional deadline after which public event checkout is rejected. Admin manual reservations remain allowed.';

# Event booking-close reports

## Goal

At the effective reservation closing time, automatically send the tenant the same three operational exports available in the event admin:

1. detailed reservation CSV;
2. printable reservation-list PDF;
3. A5 reservation-code PDF.

The application reuses `loadEventReservationExportData`, so only still-usable reservations are included (`status = confirmed` and `quantity_remaining > 0`).

## Effective trigger

```text
booking_closes_at ?? (date_start - booking_close_reports_fallback_hours)
```

`booking_close_reports_fallback_hours` defaults to `2` for existing and new events and is editable by the tenant admin.

Migration `093_event_booking_close_reports.sql` backfills the effective schedule for existing events. The dispatcher always filters `date_start > now()`, so past events are never emailed retroactively. If an existing future event is already inside its fallback window when the migration is applied, it becomes due immediately.

## Dispatcher

GitHub Actions workflow:

```text
.github/workflows/event-booking-close-reports.yml
```

runs every five minutes and can also be started with `workflow_dispatch`.

It uses the existing repository secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

For each due future event, it reads the opaque `booking_close_reports_dispatch_token` and calls the deployed application endpoint:

```text
POST /api/events/internal/booking-close-reports
```

The callback base URL is resolved from `tenants.storefront_url`; optional GitHub variable `EVENT_REPORTS_APP_URL` is only a fallback for tenants without a canonical storefront URL.

The result is therefore expected within the next dispatcher window, normally at most about five minutes after the configured closing time. GitHub scheduled jobs can occasionally be delayed by the platform.

## Idempotency

The callback never trusts an event id alone. It requires the current opaque dispatch token.

The migration installs `claim_event_booking_close_reports(event_id, dispatch_token)`, which locks the event and returns one of:

```text
claimed | sent | busy | stale | past_event | not_scheduled | too_early
```

A sender stuck in `sending` may be reclaimed after 15 minutes. Changing `date_start`, `booking_closes_at` or the fallback hours rotates the token and resets an unsent schedule to `pending`.

## Email-delivery webhook

At callback time Lepefy regenerates all three files from authoritative data and sends one n8n notification:

```text
/webhook/event-booking-closed-reports
```

Payload includes a deterministic `deliveryId` (`event-booking-close-reports:<eventId>:<dispatchToken>`) for n8n-side deduplication, the normal tenant notification context, `recipients`, event metadata and:

```ts
attachments: Array<{
  filename: string,
  contentType: string,
  contentBase64: string
}>
```

n8n must deduplicate on `deliveryId`, decode the three base64 attachments and send one operational email to `recipients`.

Recommended subject:

```text
Rapports définitifs · <event title>
```

## Recipients

Recipients are active rows from `tenant_notification_recipients` with:

```text
notify_event_booking_closed_reports = true
```

Existing recipients opt in by default because this is an operational event report, not marketing.

## Failure semantics

- A successful n8n handoff sets `booking_close_reports_status = sent` and `booking_close_reports_sent_at`.
- A repeated callback after success returns `already_sent` without resending.
- Generation or n8n failures set `booking_close_reports_status = error`; the next dispatcher run retries automatically.
- Manual admin reservations remain allowed after public booking close. Automatic delivery is one-shot; a later explicit resend workflow can regenerate a fresh snapshot if required.

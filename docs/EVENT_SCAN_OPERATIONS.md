# Event scan operations

The event scanner is event-scoped and uses `event_reservation_item_redemptions` as the canonical redemption ledger. Existing reservation rows and QR tokens are not rewritten by operational scanner changes.

## Backward compatibility

Migration `082_event_checkin_operations.sql` adds nullable `events.checkin_opens_at` and `events.checkin_closes_at`. `NULL` means unrestricted check-in and preserves the historical behaviour for all existing live events. Application reads use `select('*')` and treat missing fields as `NULL`, so deploying the code before applying migration 082 does not invalidate existing tickets.

## Control rules

A redemption is accepted only when the reservation belongs to the selected tenant/event, is `confirmed`, still has remaining rights, the event is not draft/cancelled, and an optional configured check-in window is open. The same rules are rechecked server-side on confirmation.

`tenant_cashier` may undo only a redemption created by that same cashier within 5 minutes. `tenant_admin`/`platform_owner` may undo older/other-operator redemptions but must provide a reason in those cases. Undo remains soft-void and never deletes the audit row.

The legacy aggregate `event_reservation_redemptions` table is retained for historical compatibility but migration 082 stops creating new aggregate rows. New operational metrics must be derived from reservation remaining quantities and/or the granular item-redemption ledger so voids remain consistent.

## Operational modes

`Contrôle complet` preserves manual per-line quantities. `Entrée rapide` only preselects one right when the scanned ticket has exactly one unambiguous available line; the operator must still confirm. There is no automatic redemption on scan.

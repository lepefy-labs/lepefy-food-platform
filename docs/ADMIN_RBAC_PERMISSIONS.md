# Admin RBAC & Permissions

> Current-state reference for the capability-driven Lepefy Admin authorization model.  
> Scope: Boutique, Événementiel, Service repas, tenant administration and Platform-only access.

## 1. Model overview

Lepefy Admin uses a dynamic **RBAC (Role-Based Access Control)** model driven by explicit application capabilities.

The long-term authorization source is:

`admin_user -> admin_membership -> admin_role -> admin_role_permissions -> admin_permissions`

`admin_users.role` and `admin_users.tenant_id` remain compatibility mirrors during the progressive rollout and must not be treated as the long-term authorization model.

### Core tables

| Table | Responsibility |
|---|---|
| `admin_users` | Admin identity, active state, profile and legacy mirrors |
| `admin_roles` | Role definition (`tenant` or `platform`, system/custom) |
| `admin_permissions` | Stable capability catalog with module and risk level |
| `admin_role_permissions` | Role-to-capability mapping |
| `admin_memberships` | User-to-tenant-to-role assignment |
| `admin_access_audit` | Audit trail for access-control administration |

## 2. System roles

| Code | Scope | Contract |
|---|---|---|
| `platform_owner` | Platform | Global Lepefy access; protected system role |
| `tenant_admin` | Tenant | Full administration of its tenant; protected system role |
| `tenant_cashier` | Tenant | Loyalty/cashier and limited scan operations |
| `admin_scanner` | Tenant | Service repas operational scanner |

Custom tenant roles receive **only explicitly assigned capabilities**.

`tenant_admin` intentionally preserves full tenant-admin semantics for every non-`platform.*` capability even during progressive backfills.

## 3. Permission evaluation

`AdminAccessContext` is resolved from the authenticated user, active admin record, tenant/global membership, role and role-permission mappings.

Authorization is evaluated through `canAdmin(context, permission)`:

- `platform_owner`: always authorized;
- `tenant_admin`: authorized for all non-`platform.*` capabilities;
- custom/system limited roles: permission key must be present in the resolved permission set.

Tenant isolation is checked independently. A correct capability never grants access to another tenant.

## 4. Progressive legacy fallback

If dynamic membership resolution is unavailable, only known legacy roles receive fallback permissions:

- `platform_owner`: `*`
- `tenant_admin`: known full tenant capability set
- `tenant_cashier`: loyalty/scan subset
- unknown dynamic role: **no legacy permissions**

This is deliberately fail-closed.

## 5. Page and API enforcement

### Admin pages

Protected admin routes resolve the minimum capability required for the page/workspace. Navigation and default destinations are filtered accordingly.

Platform routes require `platform.access`.

### Admin APIs

Legacy `/api/admin/**` handlers that still call `requireAdmin()` are routed through a central mapping:

`pathname + HTTP method -> permission key`

Typical semantics:

- `GET` / `HEAD` -> `*.view`
- mutations -> `*.manage`
- money-moving / high-risk actions -> dedicated critical capability

Unmapped legacy admin APIs must fail closed rather than inheriting `tenant_admin` behavior implicitly.

### UI actions

Sensitive controls are also gated in the UI to improve usability and error prevention. This is **not** the security boundary; the API rechecks authorization server-side.

## 6. Tenant capability catalog

| Module | Capability | Risk |
|---|---|---|
| Boutique · Commandes | `orders.view` | standard |
| Boutique · Commandes | `orders.manage` | sensitive |
| Boutique · Paiements | `shop_payments.confirm` | critical |
| Boutique · Catalogue | `catalog.view` | standard |
| Boutique · Catalogue | `catalog.manage` | sensitive |
| Boutique · Livraison | `shipping.view` | standard |
| Boutique · Livraison | `shipping.manage` | sensitive |
| Boutique · Fidélité | `loyalty.manage` | sensitive |
| Boutique · Fidélité | `loyalty.scan` | standard |
| Boutique · Croissance | `growth.manage` | standard |
| Boutique · Croissance | `growth.payouts.manage` | critical |
| Boutique · IA | `ai_knowledge.manage` | sensitive |
| Événementiel · Événements | `events.view` | standard |
| Événementiel · Événements | `events.manage` | sensitive |
| Événementiel · Réservations | `event_reservations.view` | standard |
| Événementiel · Réservations | `event_reservations.manage` | sensitive |
| Événementiel · Paiements | `event_payments.view` | sensitive |
| Événementiel · Paiements | `event_payments.confirm` | critical |
| Événementiel · Paiements | `event_payments.cancel` | critical |
| Événementiel · Paiements | `event_payments.refund` | critical |
| Événementiel · Contenu | `event_content.manage` | standard |
| Service repas | `scan.access` | standard |
| Service repas | `scan.search` | standard |
| Service repas | `scan.redeem` | sensitive |
| Service repas | `scan.metrics` | standard |
| Service repas | `scan.undo_own` | sensitive |
| Service repas | `scan.undo_any` | critical |
| Administration tenant | `tenant_settings.view` | standard |
| Administration tenant | `tenant_settings.manage` | sensitive |
| Administration tenant | `billing.view` | standard |
| Administration tenant | `ai_usage.view` | standard |

### Platform-only capabilities

- `platform.access`
- `platform.users.manage`
- `platform.roles.manage`
- `platform.ai_costs.view`
- `platform.notifications.test`

## 7. Risk levels

- **standard**: normal read/operational access;
- **sensitive**: business-data or configuration mutation;
- **critical**: money-moving action, override, or platform-level administration.

Critical capabilities should be assigned individually and only when required.

## 8. Critical financial / override boundaries

Dedicated permissions currently include:

- `shop_payments.confirm`
- `growth.payouts.manage`
- `event_payments.confirm`
- `event_payments.cancel`
- `event_payments.refund`
- `scan.undo_any`

Read access to a payment area does not implicitly grant confirm/cancel/refund rights.

## 9. Platform access administration

`/admin/platform/access` is the Platform Owner workspace for roles and permissions.

It loads:

- roles,
- permission catalog,
- role-permission mappings,
- active memberships,
- admin users,
- tenants.

System roles are protected; tenant custom roles are composed from the real capability catalog.

The current `/admin/team` flow manages account invitations, role/tenant assignment and activation/deactivation. In the current architecture this is Platform-only.

## 10. Migrations

### `085_admin_rbac_permissions.sql`

Introduces:

- admin profile fields;
- `admin_roles`;
- `admin_permissions`;
- `admin_role_permissions`;
- `admin_memberships`;
- `admin_access_audit`;
- system-role seed;
- role-permission seed;
- legacy admin membership backfill.

### `087_admin_rbac_completion_permissions.sql`

Adds the granular capabilities discovered in the full admin authorization audit:

- `shop_payments.confirm`;
- `shipping.manage`;
- `growth.payouts.manage`;
- `event_payments.refund`.

The migration also grants them to the protected `platform_owner` and `tenant_admin` system roles.

## 11. Adding a new permission

1. Add a stable `module.action` capability through an additive migration.
2. Set `module`, `label`, `description`, `risk_level`, and `position`.
3. Decide whether protected system roles receive it by contract.
4. Map the protected page/API/action to the capability.
5. Add UI gating for sensitive actions where useful.
6. Verify tenant isolation independently.
7. Test at minimum:
   - Platform Owner,
   - Tenant Admin,
   - custom role with capability,
   - custom role without capability,
   - user from another tenant.
8. Update this document and `LEPEFY_PROJECT_CONTEXT.md` when the authorization boundary changes.

## 12. Security invariants

- Authorization is enforced server-side.
- Tenant isolation is independent of capability possession.
- Custom roles follow least privilege.
- Critical financial actions use dedicated capabilities.
- Unknown legacy/dynamic roles fail closed.
- Platform permissions are never granted through `tenant_admin`.
- New admin APIs should use explicit permission enforcement rather than hard-coded role names.

## 13. Tenant-facing explanation

For tenant communication, describe the model as:

> A role is a bundle of permissions. Each collaborator receives the smallest set of permissions needed for their job. Viewing an area and performing a high-risk action inside that area can be separate rights. Lepefy checks permissions both in the interface and on the server, and every tenant membership is isolated from other tenants.

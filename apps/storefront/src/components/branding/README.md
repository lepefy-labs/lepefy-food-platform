# Tenant branding

`TenantLogo` is the shared renderer for tenant logos across the storefront.

Use the semantic variants instead of hard-coding image sizes:

- `header` for primary storefront navigation
- `hero` for brand-led public sections
- `compact` for secondary contexts such as checkout/footer

Keep tenant artwork source files tightly cropped with transparent backgrounds. `TenantLogo` intentionally uses `object-contain` so tenant artwork is never cropped.

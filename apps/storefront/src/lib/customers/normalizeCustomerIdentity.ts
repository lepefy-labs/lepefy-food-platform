export function normalizeCustomerEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase('en-US') ?? '';
  return normalized || null;
}

// Conservative by design: punctuation is removed, an explicit 00 prefix is
// converted to +, and no country code is invented.
export function normalizeCustomerPhone(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!raw || /[a-z]/i.test(raw)) return null;
  let normalized = raw.replace(/[^0-9+]/g, '');
  if (/^00\d+$/.test(normalized)) normalized = `+${normalized.slice(2)}`;
  return /^\+?\d{6,15}$/.test(normalized) ? normalized : null;
}

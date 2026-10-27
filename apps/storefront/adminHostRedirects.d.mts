export function adminHostRedirects(env: { ADMIN_HOST?: string; ADMIN_FALLBACK_HOST?: string }): {
  source: string;
  has: { type: 'host'; value: string }[];
  destination: string;
  permanent: false;
}[];

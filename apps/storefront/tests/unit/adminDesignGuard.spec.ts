import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Admin Design System V2 guard (stands in for lint, which this repo does not
 * run). Every admin file uses the shared kit and the a-* / tone-* tokens only
 * (docs: docs/ADMIN_DESIGN_SYSTEM.md). Tenant colours appear only as
 * --tenant-* (identity, storefront previews).
 */
const ADMIN_ROOT = join(__dirname, '../../src/app/admin');

const RULES: { name: string; pattern: RegExp }[] = [
  { name: 'text under 12px', pattern: /\btext-(?:\[(?:[0-9]|1[01])(?:\.\d+)?px\]|2xs)\b/ },
  { name: 'raw Tailwind palette colour (use a-* / tone-* tokens)', pattern: /\b(?:bg|text|border|ring|divide|outline|from|to|fill|stroke|placeholder)-(?:gray|slate|zinc|neutral|stone|violet|purple|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|red|rose|pink)-\d{2,3}\b/ },
  { name: 'dark: variant (tokens already switch theme)', pattern: /(?<![\w-])dark:(?=[\w[!-])/ },
  { name: 'storefront --color-* token in admin (use --admin-* or --tenant-*)', pattern: /var\(--color-/ },
  { name: 'storefront tenant colour class in admin', pattern: /\b(?:bg|text|border|ring|outline|from|to|accent)-(?:primary|secondary)(?:-(?:hover|light))?\b/ },
  { name: 'hard-coded hex colour', pattern: /(?:bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\]/ },
];

/** Rules that already hold for every admin file. */
const GLOBAL_RULES: { name: string; pattern: RegExp; allow: string[] }[] = [
  { name: 'native confirm() (use ConfirmDialog / useConfirm)', pattern: /\b(?:window\.)?confirm\(['"`]/, allow: [] },
  // Overlays go through Dialog/Drawer (native <dialog>: focus trap, Escape,
  // top layer). The loyalty camera viewfinder is a full-screen camera view.
  { name: 'hand-made overlay (use Dialog / Drawer)', pattern: /\bfixed inset-0\b/, allow: ['loyalty/scan/CameraScanButton.tsx'] },
  // Text controls are outlined by the field token (>= 3:1), never by the hairline border.
  { name: 'text control class with border-a-border (use controlClasses / border-a-field)', pattern: /const \w*(?:INPUT|SELECT|FIELD|TEXTAREA|[Ii]nput|[Ff]ield|[Ss]elect)\w* =\s*['`][^'`]*\bborder-a-border(?:-strong)?(?![-\w])/, allow: [] },
];

function filesUnder(path: string): string[] {
  const full = join(ADMIN_ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((entry) => filesUnder(join(path, entry))).filter((file) => /\.(tsx?|css)$/.test(file));
}

const rel = (file: string) => relative(ADMIN_ROOT, file).split('\\').join('/');

test('admin files follow the design system rules', () => {
  const violations: string[] = [];
  for (const file of filesUnder('.')) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) violations.push(`${rel(file)}:${index + 1} ${rule.name}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

test('global admin rules hold everywhere', () => {
  const violations: string[] = [];
  for (const file of filesUnder('.')) {
    const path = rel(file);
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const rule of GLOBAL_RULES) {
      if (rule.allow.includes(path)) continue;
      lines.forEach((line, index) => { if (rule.pattern.test(line)) violations.push(`${path}:${index + 1} ${rule.name}`); });
    }
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

/**
 * No em-dash (U+2014) in admin copy, aria-labels or sr-only text: use a colon,
 * a comma or a middle dot. Comment lines and the isolated missing-value
 * placeholder ('—', "—", `—`, >—<) are ignored.
 *
 * BASELINE: file (relative to src/app/admin) -> maximum number of remaining
 * occurrences, left by modules not yet cleaned. It must only shrink, never
 * grow: a file above its count (or absent from the map, i.e. 0) fails. When a
 * module is cleaned, lower or delete its entry. Never add a new entry.
 * navigation.ts (outside app/admin) has no baseline: 0.
 */
const EM_DASH_BASELINE: Record<string, number> = {
  '_components/help/HelpHeaderButton.tsx': 2,
  '_components/support/SupportHeaderButton.tsx': 2,
  '_components/ui/BulkTrackingModal.tsx': 1,
  '(protected)/_staging-preview/page.tsx': 1,
  '(protected)/accueil-slides/HeroSlidesSection.tsx': 8,
  '(protected)/ai-lab/KnowledgeBaseClient.tsx': 2,
  '(protected)/ambassadeurs/AmbassadorConfigSection.tsx': 1,
  '(protected)/ambassadeurs/AmbassadorsListSection.tsx': 1,
  '(protected)/ambassadeurs/CommissionsSection.tsx': 2,
  '(protected)/ambassadeurs/PayoutsSection.tsx': 1,
  '(protected)/ambassadeurs/PromoteAmbassadorSection.tsx': 2,
  '(protected)/avis/ReviewAdminClient.tsx': 2,
  '(protected)/canaux/whatsapp/_components/ChannelIdentityPanel.tsx': 2,
  '(protected)/catalogue/[id]/ProductEditClient.tsx': 10,
  '(protected)/catalogue/CatalogueFacets.tsx': 1,
  '(protected)/catalogue/CategoryBulkAction.tsx': 1,
  '(protected)/catalogue/page.tsx': 1,
  '(protected)/evenementiel/devis/_components/InquiryDetail.tsx': 1,
  '(protected)/evenementiel/evenements/EventsListClient.tsx': 1,
  '(protected)/evenementiel/galerie/GalleryClient.tsx': 1,
  '(protected)/evenementiel/livraison-materiel/RentalDeliveryZonesClient.tsx': 1,
  '(protected)/evenementiel/ModuleSettingsToggle.tsx': 1,
  '(protected)/evenementiel/reservations-materiel/RentalReservationsClient.tsx': 1,
  '(protected)/evenementiel/services/[id]/RentalCatalogAdmin.tsx': 1,
  '(protected)/evenementiel/services/page.tsx': 1,
  '(protected)/livraison/assistant/AssistantClient.tsx': 3,
  '(protected)/livraison/assistant/page.tsx': 1,
  '(protected)/livraison/emballages/PackagingProfilesSection.tsx': 1,
  '(protected)/livraison/emballages/page.tsx': 1,
  '(protected)/livraison/historique/page.tsx': 3,
  '(protected)/livraison/ShippingCountryRulesSection.tsx': 3,
  '(protected)/livraison/ZonesSection.tsx': 2,
  '(protected)/loyalty/LoyaltyConfigSection.tsx': 2,
  '(protected)/loyalty/PendingReviewSection.tsx': 1,
  '(protected)/loyalty/ReferralAccessSection.tsx': 3,
  '(protected)/loyalty/StuckSignupBonusSection.tsx': 3,
  '(protected)/orders/AdminOrdersPoller.tsx': 1,
  '(protected)/outils/page.tsx': 1,
  '(protected)/parametres/NotificationRecipientsSection.tsx': 6,
  '(protected)/parametres/retrait/OpeningHoursSection.tsx': 2,
  '(protected)/platform/abonnements/AbonnementsClient.tsx': 2,
  '(protected)/platform/assistance/[id]/PlatformTicketClient.tsx': 1,
  '(protected)/platform/catalogues-whatsapp/SourcesClient.tsx': 1,
  '(protected)/platform/catalogues-whatsapp/ui.ts': 1,
  '(protected)/platform/feedback/TesterCampaignPanel.tsx': 1,
  '(protected)/platform/livraison/analyse-tarifaire/TariffLabClient.tsx': 9,
  '(protected)/platform/livraison/forfait-laboratoire/ForfaitLabClient.tsx': 4,
  '(protected)/platform/livraison/laboratoire/[id]/page.tsx': 1,
  '(protected)/platform/livraison/laboratoire/[id]/ResampleCampaignButton.tsx': 2,
  '(protected)/platform/livraison/laboratoire/CampaignDestinationPicker.tsx': 1,
  '(protected)/platform/livraison/laboratoire/CampaignManager.tsx': 6,
  '(protected)/platform/livraison/laboratoire/page.tsx': 1,
  '(protected)/platform/livraison/laboratoire/PostalCodeIndexAdmin.tsx': 1,
  '(protected)/platform/livraison/laboratoire/ShippingSimulator.tsx': 4,
  '(protected)/platform/notifications/auth-mail/page.tsx': 1,
  '(protected)/platform/notifications/sante/page.tsx': 1,
  '(protected)/platform/prospects/ProspectDetail.tsx': 1,
  '(protected)/platform/prospects/ProspectsClient.tsx': 1,
  '(protected)/products/[id]/etichetta/[jobId]/LabelJobEditorClient.tsx': 8,
  '(protected)/products/[id]/etichetta/LabelGeneratorClient.tsx': 5,
  '(protected)/products/[id]/etichetta/LabelJobsListClient.tsx': 3,
  'evenementiel/scan/ScanClient.tsx': 8,
  'loyalty/scan/ScanClient.tsx': 4,
  'orders/[id]/OrderDetail.tsx': 1,
  'orders/[id]/OrderDocumentsCard.tsx': 2,
};

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|\{\/\*)/;
const MISSING_VALUE_PLACEHOLDER = /(['"`])—\1|>—</g;

function countEmDashes(source: string): number {
  return source.split('\n').reduce((total, line) => {
    if (COMMENT_LINE.test(line)) return total;
    return total + (line.replace(MISSING_VALUE_PLACEHOLDER, '').match(/—/g)?.length ?? 0);
  }, 0);
}

test('admin copy has no em-dash beyond the shrinking per-file baseline', () => {
  const violations: string[] = [];
  const check = (path: string, file: string) => {
    const found = countEmDashes(readFileSync(file, 'utf8'));
    const allowed = EM_DASH_BASELINE[path] ?? 0;
    if (found > allowed) violations.push(`${path}: ${found} em-dash(es), baseline ${allowed} (use a colon, a comma or a middle dot)`);
  };
  for (const file of filesUnder('.')) check(rel(file), file);
  check('lib/admin/navigation.ts', join(__dirname, '../../src/lib/admin/navigation.ts'));
  expect(violations, violations.join('\n')).toEqual([]);
});

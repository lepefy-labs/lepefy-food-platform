# Admin Design System V2

> Stato: in adozione progressiva (unità U0–U12, avvio 10/10/2026). Regole vincolanti in `AGENTS.md › Admin Design System V2 contract`.
> Proposta approvata (audit, mockup PRE/POST, piano): artifact «Lepefy Admin V2».

## 1. Principi

- **Dashboard operativa, non landing page**: densità alta ma leggibile, il riepilogo prima del dettaglio, lo stato codificato in forma (badge, banda) oltre che in colore.
- **Tre famiglie di colore separate**: brand Lepefy (azioni primarie, selezione, focus), branding tenant (solo identità: logo, anteprime storefront), toni semantici (stati operativi). Un ordine in errore è riconoscibile qualunque sia il colore del tenant.
- **Un solo modo per ogni compito**: un bottone, un badge, una card KPI, un dialog, un toast, una tabella, una barra filtri.
- **Server first**: liste come Server Components guidate dall'URL; il client gestisce solo interazione (selezione, dialog, palette).

## 2. Token (`src/lib/admin/tokens.ts`)

Emessi da `app/admin/layout.tsx`: valori chiari su `:root`, scuri su `:root.dark` (classe gestita da `AdminThemeProvider`). Esposti a Tailwind (`tailwind.config.ts`):

| Classe Tailwind | Variabile | Uso |
|---|---|---|
| `bg-a-bg` | `--admin-page-bg` | fondo pagina |
| `bg-a-surface`, `bg-a-surface-2` | `--admin-surface`, `--admin-surface-subtle` | card, pannelli, intestazioni di tabella |
| `border-a-border`, `border-a-border-strong` | `--admin-border*` | separatori; bordo di input e bottoni secondari |
| `text-a-text`, `text-a-text-2`, `text-a-text-3` | `--admin-text*` | testo, testo secondario, metadati (tutti ≥ 4,5:1) |
| `bg-a-hover`, `bg-a-selected` | `--admin-hover`, `--admin-selected` | hover di riga/voce, riga o voce selezionata |
| `bg-a-brand`, `text-a-on-brand`, `bg-a-brand-soft`, `text-a-brand-fg` | `--admin-primary*` | azione primaria, voce attiva, link d'azione |
| `outline-a-focus` | `--admin-focus` | focus visibile |
| `bg-tone-{t}-bg`, `text-tone-{t}-fg`, `border-tone-{t}-border`, `bg-tone-{t}-solid` | `--admin-tone-{t}-*` | stati: `info`, `success`, `warning`, `urgent`, `danger`, `neutral` |

Significato dei toni: `info` nuovo / in corso normale · `warning` serve lavoro · `urgent` critico nel tempo (ritardi, catena del freddo) · `danger` errore o blocco · `success` concluso · `neutral` inerte (annullato, bozza).

Le classi Tailwind devono comparire letterali nel sorgente (niente `bg-tone-${tone}-bg`): usare le mappe di `ui/Badge.tsx` (`TONE_BADGE_CLASS`, `TONE_SOLID_BG_CLASS`).

`platform_branding` può sovrascrivere brand e superfici chiare; i testi restano fissi. `tests/unit/adminTokens.spec.ts` verifica AA (4,5:1) per ogni coppia testo/fondo in entrambi i temi.

Transitorio fino a U12: alias `--admin-text-muted`, `--admin-{info,warning,danger,success}-{bg,fg}`, rimappatura `--color-primary*` e rete di sicurezza dark (`adminDarkTheme.ts`) per le pagine non ancora migrate.

## 3. Tipografia

Inter per l'interfaccia, Bricolage Grotesque (`font-display`) solo per il titolo di pagina. Variabili `next/font` su `<html>` (vedi `LEPEFY_PROJECT_CONTEXT.md` §15).

| Ruolo | Classi | Note |
|---|---|---|
| Titolo pagina | `font-display text-xl sm:text-2xl font-semibold` | solo in `AdminPageHeader` |
| Titolo sezione | `text-base font-semibold` | |
| Testo / cella | `text-sm` (14/20) | |
| Etichetta, badge, intestazione colonna | `text-xs font-semibold` (12/16) | |
| Metadati | `text-xs text-a-text-3` | minimo assoluto 12 px |
| Importi | `text-sm font-semibold tabular-nums`, allineati a destra | via `formatMoney` |
| Valore KPI | `text-2xl font-bold tabular-nums` | |

## 4. Kit

### `src/lib/admin/`
- `tokens.ts` — token e contrasto.
- `format.ts` — `formatMoney`, `formatNumber`, `formatWeight`, `formatDate` (`date` / `datetime` / `time` / `short`, fuso Europe/Rome), `formatRelative`, `pluralize`.
- `statusRegistry.ts` — stato di dominio → `{ label, tone }` (`ORDER_STATUS_META`, `PAYMENT_STATUS_META`, `statusMeta()`).

### `src/app/admin/_components/ui/`
- `Button` (`primary` · `secondary` · `outline` · `ghost` · `danger`, taglie `md`/`sm`, `type="button"` di default), `ButtonLink`, `ButtonAnchor`, `IconButton` (etichetta obbligatoria), `buttonClasses()`.
- `Badge` (tono, `dot` per gli stati), `CountBadge`; `StatusBadge` per gli ordini (dal registry).
- `AdminStatCard` — unica card KPI: superficie neutra, banda di tono a sinistra, valore zero attenuato, link opzionale con `aria-current`.
- `AdminPageHeader` — breadcrumb, titolo, meta, azioni, slot tab.
- `Dialog` / `Drawer` — elemento nativo `<dialog>` (`showModal()`: top layer, focus contenuto, sfondo inerte, Esc) in portal su `document.body`; bottom sheet su telefono, centrato da `sm`; `dismissible={false}` mentre un'azione è in corso; footer con azioni (impilate su telefono). Per i form nel dialog: `<form id>` nel corpo e `<Button type="submit" form={id}>` nel footer.
- `ConfirmDialog` — unica conferma: conseguenze esplicite in `description`, `destructive`, `reason` (motivo facoltativo/obbligatorio), `confirmDisabled`, `error`. `useConfirm()` restituisce `ask(...) → Promise<boolean>` per gli handler async esistenti; `useUnsavedChangesGuard(dirty)` intercetta link e chiusura scheda con modifiche non salvate.
- `AdminToaster` (montato nel layout protetto) + `useAdminToast()` — `success` / `error` / `info`, regione `aria-live`, errori più lunghi, azione opzionale con link.
- `useAdminMutation()` — scrittura client: `run(url, { body | form, method, withKey, refresh, successMessage, errorToast })`, errore francese dall'API, chiave di richiesta stabile tra i retry (sostituisce `useGestionMutation`, ora alias).
- `InlineAlert` (tono, titolo, azione; `role="alert"` per `danger`) ed `ErrorText`.
- `Form`: `FormField` (label, hint, errore, `required`/`optional`, collega `aria-describedby`/`aria-invalid`), `Input`, `Select`, `Textarea`, `inputClasses`.
- `BulkTrackingModal`, `BulkDocumentsDialog` (Commandes) già sul kit.

## 5. Controllo automatico

`tests/unit/adminDesignGuard.spec.ts` (eseguito da `pnpm test:unit`, perché `pnpm lint` non si usa):
- sui percorsi in `MIGRATED` rifiuta testo < 12 px, palette Tailwind diretta, varianti `dark:`, `var(--color-primary…)`, colori esadecimali. Ogni modulo migrato si aggiunge alla lista;
- su tutto `app/admin` rifiuta già `confirm()` nativo e overlay `fixed inset-0` scritti a mano. Eccezioni: il mirino fotocamera di `loyalty/scan/CameraScanButton.tsx` (vista a schermo intero, non un dialog) e `AdminMobileNav` fino a U3.

## 6. Stato di adozione

| Unità | Contenuto | Stato |
|---|---|---|
| U0 | Font di piattaforma risolti su `<html>` | ✅ `49b1d3b7` |
| U1 | Token, Tailwind `a-*`/`tone-*`, format, registry stati, Button, Badge, StatCard, PageHeader, guard | ✅ `de70404a` |
| U2 | Dialog, ConfirmDialog, Drawer, Toaster, InlineAlert, Form, useAdminMutation; 18 overlay e 10 `confirm()` migrati | ✅ |
| U3 | Shell: registry navigazione, sidebar, workspace, palette comandi, barra mobile | — |
| U4 | Kit dati: listParams, FilterBar, DataTable, Pagination, stati vuoto/errore | — |
| U5–U11 | Commandes, Livraison, Clients, Catalogue, Gestion, Événementiel, altri moduli | — |
| U12 | Rimozione rete di sicurezza dark e `--color-primary` in admin | — |

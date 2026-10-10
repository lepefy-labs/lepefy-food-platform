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
| `bg-a-inverse`, `text-a-on-inverse` | `--admin-inverse-*` | superficie invertita (scura in chiaro, chiara in scuro) e il suo testo |
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

### Liste e dati (`src/lib/admin/listParams.ts`, `src/app/admin/_components/data/`)
- **`defineListParams(spec, { pageSizes, defaultPageSize })`**: stato URL tipizzato (`search`, `string`, `enum` con default, `date`, `int`, `bool`, `uuid`) + `page`/`size`. `parse(searchParams)` sul server, `href(path, current, patch)` (ogni cambio diverso dalla pagina torna a pagina 1, i default non finiscono nell'URL), `activeCount()`. `pageWindow(total, page, size)` dà limiti `.range()` e la pagina corretta; `pageNumbers()` le pagine con i salti.
- **`FilterBar`** (client): viste rapide (link calcolati sul server, con contatore e tono), ricerca istantanea (debounce 350 ms, Esc svuota), pannello « Filtres » (`select`, `date-range`) in `Dialog`, chip dei filtri attivi + « Tout effacer », ordinamento, contatore risultati `aria-live`, barra di avanzamento durante la transizione. Ogni modifica sostituisce l'URL e la pagina server si ricarica: niente ordinamenti lato client su pagine parziali.
- **`DataTable`** (compatibile server): colonne (`cell`, `align`, `hideBelow`, `sortKey` → intestazione link con `aria-sort`), gruppi di righe (`groups` con tono), banda di attenzione (`rowTone`), dettaglio sotto riga (`rowDetail`), card mobile (`mobileCard`, la tabella sparisce sotto `md`), densità `comfortable`/`compact`, `empty`.
- **Selezione** (`RowSelection.tsx`, client): `RowSelectionProvider` (si azzera con le righe visibili), `RowCheckbox`, `SelectAllCheckbox` (stato indeterminato), `BulkBar` fluttuante con le azioni sugli id selezionati.
- **`Pagination`** (server, solo link): « 1–50 sur 312 », pagine con salti, « Lignes par page 25 · 50 · 100 ».
- **Stati** (`ui/States.tsx`): `EmptyState` (`empty` / `filtered`), `ErrorState` (con azione « Réessayer »), `Skeleton`, `ListPageSkeleton` per i `loading.tsx`.
- **`Panel`**, `Card`, `DescriptionList`/`DescriptionItem` (`ui/Panel.tsx`, promossi da Gestion); **`AdminTabs`** (`ui/Tabs.tsx`) per le sotto-pagine (Livraison, WhatsApp, sezioni piattaforma).

### Shell e navigazione (`src/lib/admin/navigation.ts`, `src/app/admin/_components/shell/`)
- **Registry** `ADMIN_NAV` (voci) e `ADMIN_QUICK_ACTIONS` (azioni della palette): `id`, `label`, `href`, `icon`, `group`, `workspace`, `anyOf` (capability), `flag` (`gestion`, `whatsapp`), `match`/`alsoActive`, `badge` (chiave + tono), `mobile` (posizione nella barra), `keywords`. Aggiungere un modulo = una voce; il gruppo appare se ha almeno una voce visibile.
- **Risoluzione** `resolveAdminNavigation()` nel layout protetto (permessi già ristretti dalla sospensione, flag letti sul server): il client riceve solo gli id visibili, i badge e gli scope di ricerca.
- **`AdminShell`**: rail desktop 240 px comprimibile a 64 px (pallino al posto del contatore), drawer mobile `Dialog placement="left"`, barra mobile in basso, palette comandi (`Dialog bare placement="top"`, combobox + listbox, ↑ ↓ Entrée, ricerca remota con debounce), link « Aller au contenu ».
- **`Menu`** (`ui/Menu.tsx`): menu a tendina accessibile (frecce, Home/End, Esc riporta il focus, click esterno) per workspace e account.
- La piattaforma resta in `platformNavConfig.ts` (gruppi espandibili), resa dalla stessa shell.

### Commandes (modulo pilota)
- Stato URL in `lib/orders/orderListParams.ts` (`ORDER_LIST`, `parseOrderList`, sort legacy `date_desc`… ancora accettati), condiviso da `/admin` ed export.
- `GET /api/admin/orders/export` (`orders.view`): stessi filtri e ordinamento della lista, max 2 000 righe (`X-Export-Truncated`), CSV UTF-8 con BOM, `;`, importi con virgola, formule neutralizzate (`lib/orders/ordersCsv.ts`).
- Le card KPI e i chip « Contrôles » sono filtri (secondo clic annulla); cambiare statut/paiement dal pannello azzera la vista (`panelClears`).
- « Traiter la sélection » chiede conferma (solo le commande « En préparation » cambiano stato).

### Migrazione dei moduli legacy
I moduli esistenti passano ai token con un codemod a regole fisse (una unità per modulo), poi con gli interventi strutturali del modulo:
- grigi → `a-text` (800–950), `a-text-2` (600–700), `a-text-3` (≤ 500); fondi `a-surface`/`a-surface-2`/`a-hover`/`a-border`, scuri (≥ 600) → `a-inverse`; bordi `a-border`/`a-border-strong`;
- rosso/rosa → `danger`, ambra/giallo → `warning`, arancio → `urgent`, verde/smeraldo/teal → `success`, blu/sky/ciano/indaco → `info` (fondi chiari → `-bg`, pieni → `-solid`, testi → `-fg`, bordi → `-border`); viola → brand;
- `text-white` su `bg-a-brand` / `bg-a-inverse` → `text-a-on-brand` / `text-a-on-inverse`;
- varianti `dark:` rimosse (i token cambiano tema); un `bg-white` accompagnato da `dark:bg-white` (logo, QR) resta bianco;
- `text-[10px]`, `text-[11px]`, `text-2xs` → `text-xs`; `var(--color-primary*)` → `var(--admin-primary*)` / token.

## 5. Controllo automatico

`tests/unit/adminDesignGuard.spec.ts` (eseguito da `pnpm test:unit`, perché `pnpm lint` non si usa):
- sui percorsi in `MIGRATED` rifiuta testo < 12 px, palette Tailwind diretta, varianti `dark:`, `var(--color-primary…)`, colori esadecimali. Ogni modulo migrato si aggiunge alla lista;
- su tutto `app/admin` rifiuta già `confirm()` nativo e overlay `fixed inset-0` scritti a mano. Eccezione: il mirino fotocamera di `loyalty/scan/CameraScanButton.tsx` (vista a schermo intero, non un dialog).
- `tests/unit/adminNavigation.spec.ts`: id unici, coerenza registry ↔ `adminRoutePermissions`, visibilità per ruolo, stato attivo, barra mobile.

## 6. Stato di adozione

| Unità | Contenuto | Stato |
|---|---|---|
| U0 | Font di piattaforma risolti su `<html>` | ✅ `49b1d3b7` |
| U1 | Token, Tailwind `a-*`/`tone-*`, format, registry stati, Button, Badge, StatCard, PageHeader, guard | ✅ `de70404a` |
| U2 | Dialog, ConfirmDialog, Drawer, Toaster, InlineAlert, Form, useAdminMutation; 18 overlay e 10 `confirm()` migrati | ✅ `0c949f50` |
| U3 | Shell: registry navigazione, sidebar comprimibile, workspace, palette comandi, barra mobile, ricerca Gestion | ✅ `0661cbcb` |
| U4 | Kit dati: listParams, FilterBar, DataTable, selezione e BulkBar, Pagination, stati, Panel, Tabs | ✅ |
| U5 | Commandes: lista sul kit (FilterBar, DataTable a gruppi di priorità, BulkBar con conferma, Pagination 25/50/100), Contrôles cliccabili, export CSV della lista filtrata, `loading.tsx` del gruppo protetto | ✅ |
| U6 | Livraison: classi legacy convertite ai token (codemod), token « inverse » | ✅ |
| U7–U11 | Clients, Catalogue, Gestion, Événementiel, altri moduli | — |
| U12 | Rimozione rete di sicurezza dark e `--color-primary` in admin | — |

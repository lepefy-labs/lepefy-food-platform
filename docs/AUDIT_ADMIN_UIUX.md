# Audit UI/UX — Pannello Admin (`/admin`)

> **Data**: 2026-07-17 · **Branch**: `claude/admin-panel-redesign-ln1723`
> **Scope**: dashboard commandes (`(protected)/page.tsx`), tabella ordini (`OrdersTable.tsx`), filtri (`AdminFilters.tsx`), navigazione (`AdminSidebar.tsx`), design token (`globals.css`, `tailwind.config.ts`).
> **Mockup**: `docs/mockups/admin-commandes-redesign.html` (aprire nel browser).

---

## 1. Executive summary

Il brief di partenza descrive un pannello «datato, senza gerarchia, senza badge, senza filtri». **L'audit del codice reale racconta una storia diversa**: badge di stato colorati, righe espandibili, ricerca client-side, 4 filtri URL-driven, KPI card con delta mensile e un inizio di design system a token CSS esistono già. Ripartire da zero sarebbe uno spreco.

I gap **reali** sono altri, e sono seri:

| # | Gap | Gravità |
|---|-----|---------|
| 1 | **Accessibilità**: testo a 10px, contrasti fino a 2.5:1 (target WCAG AA: 4.5:1) | 🔴 Alta |
| 2 | **Mobile**: la tabella a 10 colonne ha solo `overflow-x-auto` — su smartphone è inutilizzabile | 🔴 Alta |
| 3 | **Azioni bulk assenti**: nessuna selezione righe, nessun export CSV, nessuna stampa multipla | 🟠 Media |
| 4 | **Nessun feedback**: zero toast/notifiche; nessun realtime sui nuovi ordini | 🟠 Media |
| 5 | **Filtro Statut incompleto**: mancano le opzioni `Nouveau` e `Prêt à retirer` (gli stati esistono nei badge ma non sono filtrabili) | 🟠 Media |
| 6 | **Scalabilità**: `limit(500)` senza paginazione; KPI calcolate in JS su *tutti* gli ordini del tenant | 🟡 Bassa oggi, cresce col volume |
| 7 | **Coerenza**: colori badge hardcoded inline in 3 componenti diversi; codice morto (`AdminNav.tsx`, `AdminOrdersClient.tsx`, `orders/id/`) | 🟡 Bassa |

**Raccomandazione principale**: nessuna riscrittura. Un piano incrementale in 5 fasi (§6) che parte da accessibilità + consolidamento token, poi mobile, poi bulk actions, poi realtime, poi paginazione.

---

## 2. Stato attuale: cosa esiste già (non rifare)

| Proposta del brief | Stato nel codice |
|---|---|
| Badge colorati per stato ordine | ✅ Esiste (`StatusBadge` in `OrdersTable.tsx` con 6 stati + palette dedicata) |
| Ricerca globale | ✅ Esiste (client-side su nome/email/n° ordine) |
| Filtri (stato, data, …) | ✅ Esistono 4 select URL-driven (statut, période, livraison, paiement) |
| Card metriche | ✅ Esistono 5 KPI card, con delta % mese/mese e link contestuale «À expédier» |
| Bordi arrotondati 8px, ombre leggere | ✅ Già token: `--radius-sm: 8px`, `--shadow-card` in `globals.css` |
| Feedback hover sui pulsanti | ✅ Presente ovunque (`hover:bg-*`, `transition-colors`) |
| Righe alternate / dettaglio prodotti | ✅ Pattern migliore: righe espandibili con pannello dettaglio articoli |

Esiste inoltre un **focus ring da tastiera globale** derivato dal colore tenant (`:focus-visible` in `globals.css`) — raro trovarlo già fatto, va preservato.

---

## 3. Valutazione delle proposte del brief

### 3.1 Palette con primario fisso `#2563EB` → ❌ **da respingere**

Il progetto è **multi-tenant**: il colore primario è un token runtime per tenant (`--color-primary`, oggi `#1d9e75` per ChloeFood), applicato dal root layout. Un blu hardcoded romperebbe il theming di ogni altro tenant.

**Alternativa corretta — due livelli di colore:**

- **Colore di brand** (pulsanti primari, link, focus, stato attivo): sempre `var(--color-primary)` e derivati. Mai hex fissi.
- **Colori semantici di stato** (successo/avviso/errore/info): questi **sì** come token fissi di piattaforma, uguali per tutti i tenant — lo stato di un ordine non deve cambiare significato cambiando negozio:

```css
/* globals.css — aggiunta proposta */
:root {
  /* Semantic status — platform-level, tenant-independent */
  --status-info-bg:     #EFF6FF; --status-info-fg:     #1D4ED8; --status-info-dot:    #3B82F6;
  --status-warn-bg:     #FFFBEB; --status-warn-fg:     #B45309; --status-warn-dot:    #F59E0B;
  --status-success-bg:  #F0FDF4; --status-success-fg:  #15803D; --status-success-dot: #22C55E;
  --status-danger-bg:   #FEF2F2; --status-danger-fg:   #B91C1C; --status-danger-dot:  #EF4444;
}
```

⚠️ Attenzione anche al verde tenant: **bianco su `#1d9e75` = 3.4:1**, sotto il minimo 4.5:1 per testo normale. Per i pulsanti pieni usare `--color-primary-dark` (già definito via `color-mix`, ≈ 5.3:1 con testo bianco) oppure riservare il primario pieno a testo grande/icone.

### 3.2 Badge «testo bianco su colore pieno» → ❌ **da respingere (accessibilità)**

Contrasti misurati (formula WCAG 2.x):

| Combinazione proposta dal brief | Contrasto | Esito AA (4.5:1) |
|---|---|---|
| Bianco su `#F59E0B` (avviso) | **2.15:1** | ❌ |
| Bianco su `#10B981` (successo) | **2.54:1** | ❌ |
| Bianco su `#EF4444` (errore) | 3.76:1 | ❌ |
| Bianco su `#2563EB` (info) | 5.17:1 | ✅ |

L'implementazione **attuale** (sfondo tinta chiara + testo scuro, es. `#B45309` su `#FFFBEB` ≈ **4.9:1**) è già superiore alla proposta. Va mantenuta e migliorata, non sostituita.

**Miglioramento da aggiungere**: un **pallino colorato (dot)** dentro il badge. Motivo: WCAG 1.4.1 *Use of Color* — lo stato non deve essere comunicato dal solo colore; il dot + etichetta testuale coprono anche daltonismo (l'8% degli uomini). Le emoji 🟢🟡🔴 del brief vanno evitate nei badge: rendering incoerente tra OS e rumore per gli screen reader.

### 3.3 Raggruppare colonne → ✅ **sì, con misura**

10 colonne oggi (freccia, commande, client, produits, destination, montant, statut, paiement, transporteur, azioni). Proposta:

- **Commande + Client → una colonna** «Commande»: n° ordine + data su riga 1, nome cliente su riga 2 (l'email si sposta nel pannello espanso: in lista serve raramente).
- **Paiement + Transporteur** → colonne secondarie, nascoste sotto `lg:` e sempre visibili nel pannello espanso.
- Risultato: **6 colonne** a schermo pieno, 4 sotto `lg`.

### 3.4 Tabella responsive con pulsante «⋯» → ⚠️ **alternativa migliore: card list**

Nascondere colonne su mobile lascia comunque una `<table>` che compete con il pollice. Pattern più collaudato per liste ordini (Shopify admin, Stripe dashboard): **sotto `md` la tabella diventa una lista di card** — una card per ordine con n°, cliente, totale, badge stato e tap sull'intera card per il dettaglio. È il pattern mostrato nel mockup. Il «⋯» resta utile *dentro* la card per le azioni secondarie (picking list, cambio stato).

### 3.5 Ricerca globale + filtri a comparsa → ✅ già esistenti, 3 migliorie

1. **Completare il filtro Statut** con `new` e `ready_for_pickup` (bug funzionale, fix da 2 righe in `AdminFilters.tsx`).
2. **Date range picker** al posto delle sole opzioni fisse (oggi/settimana/mese) — basta `<input type="date">` nativo ×2, zero librerie, ottimo su mobile.
3. **Conteggi nei filtri** (es. «En préparation (3)») — i dati ci sono già nella query KPI.

---

## 4. Design system: consolidamento, non creazione

Il sistema esiste (`globals.css` + `tailwind.config.ts`). Le azioni sono di **consolidamento**:

1. **Estrarre i componenti condivisi** in `src/app/admin/_components/ui/`:
   - `StatusBadge.tsx` — oggi la mappa colori è duplicata inline in `OrdersTable`, `OrderDetail` e altrove. Unica fonte di verità, basata sui token semantici §3.1.
   - `Badge.tsx` (generico: payment, destination, flag), `KpiCard.tsx`, `Toast.tsx`, `BulkBar.tsx`.
2. **Tipografia — regole minime**:
   - Nessun testo sotto **12px** (`text-2xs` = 10px va riservato a elementi puramente decorativi, mai a contenuto informativo). Le occorrenze `text-[10px]` in `OrdersTable.tsx` (contatore prodotti, «Aujourd'hui», colis) salgono a 12px.
   - Testo secondario: da `text-gray-400` (**2.5:1** ❌) a `text-gray-500` (**4.8:1** ✅) come minimo assoluto su fondo bianco. `gray-400` resta solo per icone decorative e placeholder.
3. **Eliminare il codice morto**: `AdminNav.tsx` (soppiantato da `AdminSidebar`), `AdminOrdersClient.tsx`, `orders/id/PickingList.tsx` (duplicato di `orders/[id]/`). Riduce l'ambiguità su «quale componente è quello vero».

---

## 5. Librerie: cosa serve davvero (e cosa no)

| Esigenza | Raccomandazione | Perché |
|---|---|---|
| Export Excel | **`xlsx` — già in `package.json`** · formato deciso: **XLSX** | Zero dipendenze nuove: `XLSX.utils.json_to_sheet()` + `writeFile()`. XLSX evita i problemi di Excel francese con `;` vs `,` e virgola decimale |
| Notifiche push | **Web Push API** (`web-push` server-side, ~10 kB) | Standard, senza servizi terzi a pagamento; vedi Fase 4 e vincolo §8.8 |
| Toast | **`sonner`** (~3 kB) oppure componente proprio (~40 righe) | React-hot-toast e notistack sono più pesanti; sonner è accessibile (aria-live) out of the box |
| Notifiche realtime | **Supabase Realtime — già disponibile** | `supabase.channel().on('postgres_changes', { table: 'orders' })`: nessun polling, nessuna dipendenza. Richiede solo di abilitare la replica sulla tabella |
| Tabella | **Nessuna libreria** (per ora) | 500 righe max, una sola tabella: TanStack Table è overkill. Se in futuro servono sorting multiplo + column visibility + pinning, migrare a `@tanstack/react-table` (headless, compatibile col markup attuale) |
| Filtri URL | Pattern attuale (`useSearchParams` + `router.push`) va bene; `nuqs` solo se i filtri si moltiplicano | — |
| Animazioni | **CSS transitions** (già in uso). ❌ No Framer Motion | +30 kB per un admin è ingiustificato; `transition`, `@starting-style` e `prefers-reduced-motion` coprono tutto il necessario |
| Virtualizzazione | ❌ No — prima **paginazione server** (`.range()` Supabase) | La virtualizzazione cura il sintomo; con la paginazione il DOM resta piccolo e le query pure |
| Date picker | `<input type="date">` nativo | Localizzato dal browser, accessibile, touch-friendly, 0 kB |

---

## 6. Piano di implementazione (5 fasi incrementali)

Ogni fase è shippabile da sola; l'ordine massimizza il rapporto valore/rischio.

### Fase 0 — Fondamenta (½ giornata, rischio nullo)
- Token semantici di stato in `globals.css` (§3.1).
- Estrazione `StatusBadge` condiviso con dot; sostituzione delle 3 copie inline.
- Fix filtro Statut (`new`, `ready_for_pickup`).
- Rimozione codice morto.

### Fase 1 — Accessibilità (1 giorno)
- `text-[10px]` → 12px; `text-gray-400` → `text-gray-500` su tutto il testo informativo.
- Pulsanti primari: fondo `--color-primary-dark` per garantire 4.5:1 col testo bianco.
- Touch target ≥ 24×24 px (WCAG 2.2 — 2.5.8): le icone azione a `p-0.5`/`p-1.5` in tabella salgono a `p-2`.
- `aria-label` su azioni icon-only; `scope="col"` sugli `<th>`; `aria-expanded` sulle frecce.
- Audit Lighthouse + axe come baseline (v. §8).

### Fase 2 — Tabella responsive + colonne raggruppate (1–2 giorni)
- **Priorità dispositivi (decisione 17/07): PC e tablet prima di tutto** — il breakpoint critico è il tablet (`md`/`lg`, 768–1024px): la tabella a colonne raggruppate deve essere perfetta lì, perché è il dispositivo raccomandato in negozio.
- Fusione Commande+Client; Paiement/Transporteur nascoste sotto `lg`.
- Card list sotto `md` (pattern del mockup): resta necessaria perché nella pratica lo smartphone viene comunque usato, ma si rifinisce dopo il layout tablet.
- Ordinamento per data/montant (client-side finché non c'è paginazione).
- **Dark mode admin (decisione 17/07: in scope)**: si fa in questa fase, mentre si toccano già tutti gli stili — token dark in `globals.css` scoperti da `data-theme="dark"` applicato **solo sul layout admin** (lo storefront resta chiaro), toggle nell'header persistito in `localStorage`. Il mockup mostra già il risultato.

### Fase 3 — Azioni bulk + export (1–2 giorni)
- Checkbox di selezione riga + «seleziona tutto» + barra azioni flottante.
- **Export XLSX** (formato deciso) con `xlsx`: esporta la selezione, o tutto il filtro corrente.
- **Stampa picking list multipla** (apre le liste selezionate in un'unica pagina print).
- Cambio stato in bulk → nuova API route `PATCH /api/admin/orders/bulk-status` con verifica sessione + whitelist `ADMIN_EMAILS` (stesso pattern del layout protetto) + `revalidatePath('/admin')`.

### Fase 4 — Feedback, realtime & push (2 giorni)
- Toast (sonner) su ogni azione: export completato, stato aggiornato, errore rete.
- Supabase Realtime su `orders` (INSERT): toast «Nouvelle commande !» + refresh del contatore. Fallback: refetch on window focus.
- KPI «Commandes aujourd'hui» nella prima card.
- **Notifiche push (decisione 17/07)** per i nuovi ordini a pannello chiuso, via **Web Push API**:
  1. Service worker (`public/sw.js`) + richiesta permesso dal pannello admin.
  2. Tabella `push_subscriptions` (tenant_id, endpoint, chiavi p256dh/auth) — nuova migrazione Supabase.
  3. Invio server-side con il pacchetto `web-push` (chiavi VAPID in env server-only) dal punto in cui l'ordine diventa «pagato» — il webhook Stripe è il trigger naturale, così niente push per pagamenti falliti.
  4. Vincolo iOS: su iPhone/iPad le web push funzionano solo se il pannello è installato come PWA (Aggiungi a Home) — coerente con la priorità PC/tablet; su desktop e Android funziona nel browser normale.

### Fase 5 — Scalabilità (quando gli ordini superano ~1.000)
- Paginazione server con `.range()` + conteggio `{ count: 'exact', head: true }`.
- KPI spostate in una vista SQL o RPC Postgres (oggi: fetch di tutti gli ordini + `reduce` in JS, due volte).
- Ricerca spostata server-side (`.or('full_name.ilike...,email.ilike...')`).

---

## 7. Esempi di codice

### 7.1 `StatusBadge` condiviso, accessibile, token-based

```tsx
// src/app/admin/_components/ui/StatusBadge.tsx
import type { OrderStatus } from '@lepefy/types';

type Tone = 'info' | 'warn' | 'success' | 'danger' | 'neutral';

const STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  new:              { label: 'Nouveau',        tone: 'info'    },
  preparing:        { label: 'En préparation', tone: 'warn'    },
  ready_for_pickup: { label: 'Prêt à retirer', tone: 'success' },
  shipped:          { label: 'Expédié',        tone: 'info'    },
  delivered:        { label: 'Livré',          tone: 'success' },
  cancelled:        { label: 'Annulé',         tone: 'danger'  },
};

export default function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'neutral' as Tone };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                 text-xs font-semibold whitespace-nowrap"
      style={{
        background: `var(--status-${meta.tone}-bg)`,
        color:      `var(--status-${meta.tone}-fg)`,
      }}
    >
      {/* Dot: canale visivo aggiuntivo oltre al colore (WCAG 1.4.1) */}
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: `var(--status-${meta.tone}-dot)` }}
      />
      {meta.label}
    </span>
  );
}
```

### 7.2 Export XLSX/CSV con la dipendenza già installata

```tsx
// src/app/admin/_components/ui/exportOrders.ts
import * as XLSX from 'xlsx';
import type { ListOrder } from '../../(protected)/OrdersTable';

export function exportOrders(orders: ListOrder[], format: 'xlsx' | 'csv' = 'xlsx') {
  const rows = orders.map(o => ({
    'N° commande':  `#${o.id.slice(0, 8).toUpperCase()}`,
    'Date':         new Date(o.created_at).toLocaleDateString('fr-FR'),
    'Client':       o.full_name ?? '',
    'Email':        o.email,
    'Articles':     (o.order_items ?? []).map(i => `${i.quantity}× ${i.name}`).join(' | '),
    'Total (€)':    (o.total / 100).toFixed(2).replace('.', ','),
    'Statut':       o.status,
    'Paiement':     o.payment_method ?? '',
    'Livraison':    o.fulfillment_type === 'pickup' ? 'Click & Collect' : 'Domicile',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Commandes');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `commandes-${date}.${format}`, format === 'csv' ? { bookType: 'csv' } : undefined);
}
```

### 7.3 Pattern responsive «tabella → card» (struttura)

```tsx
{/* Desktop ≥ md: tabella */}
<div className="hidden md:block overflow-x-auto">
  <table className="w-full text-sm">…</table>
</div>

{/* Mobile < md: card list */}
<ul className="md:hidden divide-y divide-gray-100">
  {orders.map(o => (
    <li key={o.id}>
      <Link href={`/admin/orders/${o.id}`} className="flex items-start gap-3 p-4 active:bg-gray-50">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-medium text-gray-600">
              #{o.id.slice(0, 8).toUpperCase()}
            </span>
            <StatusBadge status={o.status} />
          </div>
          <p className="text-sm font-medium text-gray-900 mt-1 truncate">{o.full_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {(o.order_items ?? []).length} article(s) · {formatPrice(o.total, currency)}
          </p>
        </div>
      </Link>
    </li>
  ))}
</ul>
```

Il mockup completo e navigabile (desktop + mobile + dark mode + bulk bar + toast) è in **`docs/mockups/admin-commandes-redesign.html`**.

---

## 8. Vincoli tecnici e rischi

1. **Theming multi-tenant vs Tailwind**: le classi Tailwind sono statiche a build time; i colori tenant devono passare da CSS custom properties (pattern già in uso: `bg-[var(--color-primary)]`). Mai hex di brand hardcoded nei componenti.
2. **Bulk actions = nuova superficie API**: la tabella è un Client Component ma le mutazioni devono passare da API route server con la **stessa doppia verifica** del layout protetto (sessione Supabase + whitelist `ADMIN_EMAILS`). Il service client bypassa RLS: la verifica applicativa è l'unica barriera.
3. **Cookie API `@supabase/ssr@0.3.x`**: qualsiasi nuova route admin deve fornire `get/set/remove` *e* `getAll/setAll` (vincolo documentato in `CLAUDE.md`) — pena fallimenti silenziosi di sessione.
4. **Prestazioni con molti dati**: oggi 3 query per pageload di cui 2 senza limite scaricano tutti gli ordini del tenant per le KPI. Fino a ~1.000 ordini è accettabile; oltre, Fase 5 obbligatoria (aggregazione in SQL).
5. **Realtime**: richiede publication Postgres sulla tabella `orders`; su piani Supabase piccoli le connessioni realtime sono limitate — un solo canale condiviso per l'admin.
6. **Stampa etichette bulk (Packlink)**: l'API Packlink ha rate limit; generare N etichette in un click richiede coda/serializzazione lato server. Consiglio: fase separata, dopo la 3.
7. **`router.push` sui filtri = round-trip server** a ogni cambio filtro (Server Component). Accettabile; se diventa lento, `useTransition` + indicatore di caricamento, non client-side fetching.
8. **Web Push**: richiede HTTPS (ok su Vercel), chiavi VAPID in env server-only e una migrazione per `push_subscriptions`. Su iOS le push arrivano solo con la PWA installata (iOS ≥ 16.4); su desktop/Android nessun vincolo. Il permesso va chiesto con un'azione esplicita dell'utente (pulsante «Activer les notifications»), mai all'apertura della pagina.

---

## 9. Checklist accessibilità & strumenti di test

**Target: WCAG 2.2 livello AA.**

| Criterio | Check |
|---|---|
| 1.4.3 Contrasto testo ≥ 4.5:1 (≥ 3:1 se ≥ 24px o 18.7px bold) | gray-500 minimo su bianco; niente bianco su `#1d9e75` o ambra |
| 1.4.11 Contrasto componenti UI ≥ 3:1 | bordi input, dot dei badge, icone azione |
| 1.4.1 Uso del colore | stato = colore **+** dot **+** etichetta testuale |
| 2.5.8 Target size ≥ 24×24px | icone azione tabella, checkbox, frecce espansione |
| 2.1.1 Tastiera | riga espandibile e bulk bar operabili da tastiera; focus ring già presente |
| 4.1.2 Name/Role/Value | `aria-expanded` su frecce, `aria-label` su icon button, `aria-live="polite"` sui toast |
| 1.4.4 Zoom 200% | layout non rompe (testare con card list mobile) |

**Strumenti consigliati:**
- **Lighthouse** (Chrome DevTools → Accessibility) — baseline automatica a ogni fase, punteggio in PR.
- **axe DevTools** (estensione) — più profondo di Lighthouse su ARIA e contrasti; la versione CLI `@axe-core/playwright` è integrabile in CI quando ci sarà una test suite.
- **WAVE** (webaim.org) — visualizza gli errori in-page, ottimo per revisioni rapide.
- **WebAIM Contrast Checker** — verifica puntuale di ogni coppia colore prima di introdurla.
- **Test manuali**: navigazione solo-tastiera (Tab/Enter/Escape), zoom browser 200%, simulazione daltonismo (Chrome DevTools → Rendering → Emulate vision deficiencies), VoiceOver/NVDA sulla tabella.

---

## 10. Decisioni (17/07/2026) e domande residue

Decisioni prese con il committente, già recepite nel piano (§5, §6, §8):

| Tema | Decisione | Impatto sul piano |
|---|---|---|
| Dispositivi | Anche smartphone, ma **priorità PC e tablet** (indicazione data al negozio) | Fase 2: breakpoint tablet (`md`/`lg`) curato per primo; card list mobile mantenuta ma rifinita dopo |
| Export | **XLSX** | Fase 3: un solo formato, `commandes-AAAA-MM-GG.xlsx`; niente toggle CSV |
| Notifiche | **Push** (oltre ai toast in-app) | Fase 4 estesa: Web Push API + service worker + tabella `push_subscriptions` + trigger dal webhook Stripe; vincolo iOS in §8.8 |
| Dark mode | **Desiderata** | Inserita in Fase 2 (solo layout admin, token-based, toggle persistito) |

Domande ancora aperte:

1. **Azioni bulk — quali stati?** Il cambio stato in bulk ha senso per `preparing → shipped`? Serve anche l'annullamento in bulk (che tocca rimborsi Stripe)?
2. **Volume ordini atteso** a 12 mesi? Determina se la Fase 5 (paginazione/SQL) va anticipata.

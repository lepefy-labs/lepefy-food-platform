# Audit Frontend & UI/UX — Storefront Lepefy Food

**Data**: 16 luglio 2026
**Perimetro**: `apps/storefront` — storefront pubblico (home, catalogo, scheda prodotto, carrello, checkout, tracking ordine). L'admin è escluso da questo audit.
**Obiettivo**: valutazione onesta dello stato attuale e piano prioritizzato per modernizzare la UI/UX, mantenendo la piattaforma riutilizzabile per qualsiasi tenant futuro.
**Nota**: questo documento non implementa nulla — serve a decidere insieme cosa implementare, e in che ordine, nei prossimi `ClaudeCode_Prompt_*.md`.

---

## 1. Sintesi

Le fondamenta tecniche sono solide (App Router pulito, mobile-first con bottom-nav, sticky CTA, gestione stati carrello/checkout curata, ricerca semantica con degrado silenzioso ben pensato) ma il **design system è teorico, non applicato**: esiste un meccanismo corretto di CSS custom properties iniettate dal tenant, ma almeno **quattro superfici visive importanti bypassano completamente i token e hardcodano il verde ChloeFood (`#1D9E75`) o derivati**, inclusa l'intera pagina di tracking ordine. Peggio: il `ProductCard` esiste in **tre implementazioni copia-incollate diverse** (una corretta, due con colori hardcoded), sintomo che il pattern "usa la CSS var" non è né imposto né documentato. Tipograficamente il progetto dichiara "Inter" ma non lo carica mai: gira su system-ui di fatto, con un'unica famiglia/peso ovunque e nessuna gerarchia display/dati. Il risultato visivo è un e-commerce da delivery-app generica (ticker in stile Glovo, shelf orizzontali, card bianche piatte, emoji al posto di un'iconografia coerente) — non comunica "boutique alimentare africana curata". Il cambio brand v2 (verde → blu `#1267C7`) romperebbe visibilmente almeno 4 punti del prodotto se fatto oggi solo cambiando `tenant.primary_color`.

---

## 2. Tabella dei problemi rilevati

| Area | Problema | Impatto UX | Priorità |
|---|---|---|---|
| Multi-tenant / token | `src/app/(shop)/orders/[id]/page.tsx` — l'intera timeline di tracking (icone, barra progresso, badge "En cours") è hardcoded in verde (`#2d6a4f`, `#d8f3dc`, `#1b4332`), zero riferimenti a `var(--color-primary)` | Pagina ad alta visita (link nell'email post-acquisto) resta verde per **qualsiasi** tenant, anche ChloeFood v2 blu | **Alta** |
| Multi-tenant / token | `src/components/layout/BottomNav.tsx` hardcoda `#1D9E75` (tab attivo) e `#F2C811` (badge carrello) invece delle CSS var | La nav principale mobile non si rebrand mai | **Alta** |
| Multi-tenant / token | `HeroBanner` in `src/app/(shop)/page.tsx` hardcoda `darkBg/midBg/accentBg` (`#085041`, `#0F6E56`, `#1D9E75`) per sfondo e cerchi decorativi; riceve `primaryColor` come prop ma la ignora (`_primaryColor`) | Prima cosa vista dall'utente, ignora completamente il brand del tenant | **Alta** |
| Multi-tenant / token | `src/components/home/AddToCartButton.tsx` hardcoda `#1D9E75` come sfondo del "+" flottante | Il pulsante d'acquisto più frequente non si rebrand | **Alta** |
| Duplicazione componenti | Esistono **3 implementazioni di "ProductCard"**: `src/components/catalog/ProductCard.tsx` (corretta: `next/image` + CSS var), più due copie inline in `src/app/(shop)/page.tsx` e `src/components/home/FeaturedProducts.tsx` che usano `<img>` raw e `bg-[#E1F5EE]` hardcoded | Deriva stilistica garantita ad ogni modifica futura; causa diretta di metà dei problemi hardcoded sopra | **Alta** |
| Tipografia | `tailwind.config.ts` dichiara `fontFamily.sans: ['Inter', ...]` ma **Inter non è mai caricato** (nessun `next/font`, nessun `<link>`, nessun `@font-face`) → fallback silenzioso a system-ui | Il font "di brand" è fittizio; nessuna identità tipografica, nessuna gerarchia display/body/dati | **Alta** |
| Accessibilità | Touch target `w-7 h-7` (28×28px) su pulsanti quantità (`CartClient.tsx`, `QuantitySelector.tsx`) e sul "+" flottante (`AddToCartButton.tsx`) | Sotto il minimo consigliato 44×44px; l'utenza dichiarata è prevalentemente mobile | **Alta** |
| Performance percepita | Immagini con `<img>` raw (non `next/image`) in: `page.tsx` (ProductCard home + HeroBanner), `FeaturedProducts.tsx`, `CartClient.tsx` | Home page (massimo traffico) senza ottimizzazione AVIF/WebP, senza `sizes`, rischio CLS | **Alta** |
| Coerenza brand | Nessun elemento visivo "signature" riconoscibile: card prodotto, hero e griglia sono strutturalmente identici a un e-commerce generico da delivery app | Non comunica "boutique curata" vs marketplace generico | **Alta** (strategica) |
| Design system | Nessuna scala tipografica dichiarata: uso diffuso di `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[13px]` accanto a `text-xs/sm/base/lg/xl` senza criterio | Incoerenza dimensionale tra sezioni della stessa pagina | Media |
| Design system | Nessuna scala di radius/ombra: `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full` usati ad hoc per lo stesso tipo di elemento (card prodotto vs card carrello vs bottoni) | Percezione di incoerenza tra componenti simili | Media |
| Accessibilità | Nessun `:focus-visible` globale su bottoni/link; solo gli `<input>` hanno `focus:ring` | Navigazione da tastiera senza indicatore visibile su CTA, nav, pulsanti +/− | Media |
| Accessibilità | Nessun controllo di contrasto formalizzato su `--color-primary` usato come testo (link "Voir tout →", prezzi) | Un colore tenant futuro (es. il blu `#1267C7`) potrebbe rompere il contrasto AA senza che nulla lo segnali | Media |
| Micro-interazioni / stati | Stato vuoto di `ProductGrid.tsx` è una riga di testo grigio, mentre il carrello vuoto ha icona+titolo+CTA curati | Incoerenza di qualità percepita tra stati vuoti simili | Media |
| Coerenza brand | Uso diffuso di emoji di sistema (🛒 🚚 📦 ✅ 🏪 🔒 ⏳) mentre `BottomNav` usa correttamente icone Tabler | Linguaggio visivo doppio (icone professionali vs emoji OS-dipendenti) nella stessa esperienza | Media |
| Micro-interazioni / stati | Nessuno skeleton loader su griglia prodotti/shelves; solo `opacity-60` durante `isPending` in `CatalogClient.tsx` | Sensazione di scatto/jank su rete lenta | Bassa |
| Manutenibilità | `CategoryFilter.tsx` (standalone) e i filtri categoria inline in `CatalogClient.tsx` duplicano la stessa UI con markup leggermente diverso (`px-4 py-2` vs `px-4 py-1.5`); solo uno dei due è effettivamente usato | Doppio binario che diverge nel tempo | Bassa |
| Localizzazione | `formatPrice`/`formatDate` in `src/lib/utils/format.ts` hardcodano `'fr-FR'` ignorando `tenant.locale` | Coerente con la convenzione attuale "tutto in francese", ma rompe la promessa multi-tenant per un tenant futuro con altra lingua | Bassa (nota) |

### Cosa funziona bene (da preservare)

- **Architettura tema**: `getTenant()` → CSS custom properties iniettate in `<head>` da `src/app/layout.tsx` → Tailwind mappa `primary`/`primary-light`/`secondary` sulle var. Il meccanismo è giusto; il problema è solo che non è applicato ovunque.
- **Mobile-first reale**: bottom-nav con badge carrello, CTA sticky nel carrello, `safe-area-inset-bottom` gestito, shelf orizzontali touch-friendly.
- **Flusso carrello → checkout**: debounce sul calcolo spedizione, stati loading/errore/vuoto distinti, quote token passato via sessionStorage, CTA disabilitata con microcopy che spiega perché ("Entrez votre code postal…").
- **Ricerca**: cascata testuale → semantica con degrado silenzioso, spinner nella search bar, contatore risultati.
- **Copywriting UI**: già orientato al cliente ("Ajouter au panier", "Procéder au paiement", stati vuoti con azione chiara). Non è l'area critica.

---

## 3. Proposta di token system multi-tenant

Il meccanismo attuale è già impostato correttamente nell'architettura — **va esteso e reso vincolante**, non ripensato da zero.

### Stato attuale

`src/app/layout.tsx` inietta in `<head>`, da `getTenant()`:

```css
:root {
  --color-primary: <tenant.primary_color>;
  --color-primary-light: <tenant.accent_light>;
  --color-secondary: <tenant.secondary_color>;
}
```

con fallback statico in `globals.css` (`#1d9e75` ecc.) usato solo se il tenant non risolve — corretto, va solo documentato come "tier di default".

### Estensione proposta

Senza aggiungere colonne DB dove non serve, usando `color-mix()` (supportato in tutti i browser target di Next 14) per derivare le varianti dal solo `primary_color`:

```css
:root {
  /* ── Brand — da tenants table, MAI hardcoded nei componenti ── */
  --color-primary: <tenant.primary_color>;
  --color-primary-hover: color-mix(in srgb, var(--color-primary) 85%, black);
  --color-primary-light: <tenant.accent_light>;
  --color-secondary: <tenant.secondary_color>;

  /* ── Neutri — fissi, non da tenant (testo/superfici) ── */
  --color-ink: #111827;
  --color-ink-muted: #6b7280;
  --color-surface: #ffffff;
  --color-surface-muted: #f7f9f8;

  /* ── Semantici — fissi, non da tenant (stato, non brand) ── */
  --color-success: #16a34a;
  --color-danger: #dc2626;
  --color-info: #2563eb;

  /* ── Tipografia ── */
  --font-display: /* font "carattere", da scegliere in Fase 3 */;
  --font-body: /* font testo */;
  --font-mono: /* prezzi/tracking code, con tabular-nums */;

  /* ── Forma ── */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 999px;
  --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.06);
}
```

**Ruoli semantici** (6, non hex fissi): `primary` (azione/brand), `primary-light` (superfici brandizzate tenui), `secondary` (accento/badge), `ink`/`ink-muted` (testo), `surface`/`surface-muted` (sfondi), `success`/`danger`/`info` (stato — deliberatamente **non** tenant-dipendenti: un errore è rosso per tutti).

**Mapping da `tenants` table**: le colonne esistenti (`primary_color`, `secondary_color`, `accent_light`) bastano per la Fase 1–2. Se in Fase 3 servisse un font per tenant, aggiungere una colonna `font_preset` (enum di coppie pre-validate, non font arbitrari) è preferibile a un campo libero.

### Regola operativa (da aggiungere a CLAUDE.md o come regola ESLint custom)

> **Vietato scrivere hex literal (`#xxxxxx`) o classi Tailwind di colore brand in `apps/storefront/src/components/**` e `src/app/(shop)/**`** — solo `var(--color-*)` o le classi Tailwind mappate (`bg-primary`, `text-primary`, …). Eccezioni ammesse: colori semantici di stato via token (`--color-success` ecc.) e stili di stampa.

Questo è l'unico modo per evitare che il prossimo redesign, o il cambio verde → blu di ChloeFood v2, richieda una caccia manuale ai colori come quella documentata in questo audit.

---

## 4. Piano d'azione prioritizzato

### Fase 1 — Quick win (sforzo: S, pochi giorni)

Elimina i punti di rottura multi-tenant più gravi, zero rischio architetturale.

| Intervento | File coinvolti |
|---|---|
| Sostituire gli hex hardcoded con `var(--color-primary)` / `var(--color-secondary)` | `src/components/layout/BottomNav.tsx`, `src/components/home/AddToCartButton.tsx`, `src/app/(shop)/page.tsx` (HeroBanner), `src/app/(shop)/orders/[id]/page.tsx` (intera timeline) |
| Caricare davvero un font via `next/font/google` (anche solo completare "Inter" come primo passo a costo zero) e allineare `tailwind.config.ts` | `src/app/layout.tsx`, `tailwind.config.ts` |
| Allineare lo stato vuoto di `ProductGrid` allo standard già usato nel carrello vuoto (icona + titolo + CTA) | `src/components/catalog/ProductGrid.tsx` |
| Aggiungere `:focus-visible` globale coerente | `src/app/globals.css` |
| Portare i touch target a minimo 44×44px | `src/components/product/QuantitySelector.tsx`, `src/app/(shop)/cart/CartClient.tsx`, `src/components/home/AddToCartButton.tsx` |

### Fase 2 — Medio impatto (sforzo: M, 1–2 settimane)

Consolidamento strutturale del design system.

| Intervento | File coinvolti |
|---|---|
| **Unificare le 3 implementazioni di ProductCard** in un solo componente con varianti (griglia vs shelf orizzontale) — risolve alla radice più problemi hardcoded della Fase 1 | `src/components/catalog/ProductCard.tsx` (target), `src/app/(shop)/page.tsx`, `src/components/home/FeaturedProducts.tsx` |
| Introdurre i token estesi (`--color-primary-hover` via `color-mix`, `--radius-*`, `--shadow-card`) e migrare progressivamente radius/ombre sparsi verso la scala | `src/app/globals.css`, `tailwind.config.ts`, componenti shop |
| Migrare tutte le `<img>` residue a `next/image` | `src/app/(shop)/page.tsx`, `src/components/home/FeaturedProducts.tsx`, `src/app/(shop)/cart/CartClient.tsx` |
| Sostituire le emoji di stato con icone Tabler coerenti con la BottomNav | `orders/[id]/page.tsx`, `OrderConfirmationClient.tsx`, `CartClient.tsx`, `CheckoutForm.tsx` |
| Skeleton loading su griglia catalogo e shelves home | `src/components/catalog/CatalogClient.tsx`, `src/components/catalog/ProductGrid.tsx` |
| Dichiarare una scala tipografica ufficiale e sostituire i `text-[Npx]` arbitrari | `tailwind.config.ts`, componenti shop |
| Rimuovere il doppione `CategoryFilter.tsx` / filtri inline (tenerne uno) | `src/components/catalog/CategoryFilter.tsx`, `src/components/catalog/CatalogClient.tsx` |

### Fase 3 — Ridisegno strutturale (sforzo: L, sprint dedicato)

Qui va decisa la direzione visiva — **da non avviare senza validazione preventiva con Robertin/Dalice**, eventualmente tramite un mockup HTML interattivo (artifact separato, non codice di produzione).

| Intervento | Note |
|---|---|
| **Elemento signature** | Proposta di lavoro: un "cartellino/etichetta di bottega" su ogni card prodotto (badge angolare o etichetta), renderizzato con `var(--color-primary)`, che sostituisce lo styling piatto attuale e resta leggibile con qualunque colore tenant. Alternativa: trattamento del bordo superiore delle sezioni shelf come intestazione "da bottega" invece della card bianca anonima. Da evitare i default riconoscibili "AI-generated" (cream + serif + terracotta; nero + verde acido): nessuno dei due è motivato da questo brief. |
| **Hero home** | Uscire dal blocco fisso 160px con cerchi decorativi hardcoded, verso uno spazio editoriale che comunichi provenienza/autenticità, costruito interamente su token + `tenant.hero_image_url`. File: `src/app/(shop)/page.tsx`. |
| **Scheda prodotto** | Aggiungere segnali di fiducia/provenienza (oggi assenti: nessuna origine, nessuna certificazione, nessuna "storia" del prodotto). Verificare se i dati esistono già in `products` o vanno aggiunti a schema. File: `src/components/product/ProductDetail.tsx`. |
| **Timeline di tracking** | Ridisegnarla come componente riutilizzabile basato sui token (il fix minimo dei colori è già in Fase 1). File: `src/app/(shop)/orders/[id]/page.tsx`. |
| **Coppia tipografica** | Scegliere display + body (+ eventuale mono per prezzi/dati con `tabular-nums`), pesi intenzionali, e cablarla nei token `--font-*`. Decisione da prendere sul mockup, non in astratto. |

---

## 5. Prossimi passi

Nessuna modifica al codice è stata fatta in questa fase. I prossimi `ClaudeCode_Prompt_*.md` dovrebbero coprire, in ordine:

1. **Fase 1** — un prompt unico ("de-hardcoding + font + a11y quick wins"), a basso rischio, mergeable subito.
2. **Fase 2** — un prompt per l'unificazione ProductCard + token estesi, e uno per immagini/icone/skeleton.
3. **Mockup Fase 3** — un artifact HTML interattivo per validare elemento signature, hero e coppia tipografica prima di scrivere codice di produzione.

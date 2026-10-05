# Programma Ambassadeur (migrations 046, 051)

Documento di riferimento: cosa fa il programma, come nasce una commissione, come si configura e come si paga da `/admin/ambassadeurs`.

## 1. In una frase

Un **ambassadeur** è un cliente nominato dall'admin. Guadagna una **commissione in denaro reale** (mai punti) sulla **prima commande livrée** di ogni cliente che ha invitato con il suo link, se quella commande raggiunge l'acquisto minimo. Il cliente invitato può ricevere una riduzione sulla stessa prima commande. Il pagamento avviene **fuori dalla piattaforma** (bonifico o PayPal) e si registra in admin.

Il programma è separato dal parrainage a punti (`/admin/loyalty`). Usa però lo stesso link `/invite/[code]` e lo stesso collegamento `customers.referred_by_id`.

## 2. Ciclo di vita

```
Admin « Nommer ambassadeur »            customers.is_ambassador = true
        │
Ambassadeur condivide /invite/[code]    cookie referral_code (30 giorni)
        │
Invitato crea il suo compte (OTP)       customers.referred_by_id = ambassadeur
        │
1ª commande (checkout)                  riduzione → orders.ambassador_discount_amount
        │
1ª commande « Livrée »                  process_ambassador_commission_atomic
        │                               → ambassador_commissions (CONFIRMED)
        ├── Admin « Verser »            → PAID (paid_at, paid_by_admin_id, payment_note)
        └── Admin « Annuler »           → CANCELLED (payment_note = « Annulée : motif »)
```

### 2.1 Attribuzione
- `/invite/[code]` (`app/(shop)/invite/[code]/route.ts`) valida il codice in `referral_codes` e pone il cookie `referral_code` (httpOnly, 30 giorni). Se il codice non è valido, il redirect è silenzioso.
- L'attribuzione avviene **solo alla creazione del compte** (`api/auth/verify-otp` → `registerWithReferral`). Un cliente che ha già un compte non può essere attribuito a posteriori.
- Il link funziona da subito dopo la nomination e non dipende dal profilo di pagamento.
- Un acquisto da ospite (senza compte) non è collegabile a nessuno sponsor: niente riduzione e niente commissione.

### 2.2 Riduzione al checkout
Si applica solo se tutte queste condizioni sono vere (`lib/ambassador/resolveCheckoutAmbassadorDiscount.ts`):
- il cliente è loggato;
- il suo sponsor è **attualmente** ambassadeur;
- il cliente non ha **nessun ordine precedente** (qualsiasi stato);
- il subtotale è almeno uguale all'acquisto minimo.

| Modalità | Riduzione dell'invitato |
|---|---|
| Proportionnelle | `PERCENT`: subtotale × valore % · `FIXED`: valore, comunque ≤ subtotale. Opzionale («Aucune réduction»). |
| Pool partagé | `pool × (100 − part ambassadeur) / 100`, sempre attiva |

L'importo viene fissato dal server in `POST /api/checkout` e salvato in `orders.ambassador_discount_amount`. Lo stesso calcolo alimenta l'anteprima `/api/checkout/ambassador-discount`.

### 2.3 Commissione alla consegna
Il passaggio a `delivered` (`PATCH /admin/orders/[id]`) chiama `processAmbassadorCommissionOnDelivery` prima del calcolo dei punti, e lo fa anche se la fidélité è disattivata. La commissione viene creata solo se:
- lo sponsor è ambassadeur **al momento della consegna** (un ambassadeur rimosso non genera più nulla);
- è la **prima commande consegnata** del cliente;
- il **subtotale pre-riduzione** è almeno uguale all'acquisto minimo.

| Modalità | Commissione |
|---|---|
| Proportionnelle | `min(montant payé × taux, plafond)`, dove `taux = commission au seuil / achat minimum` e `montant payé = subtotale − riduzione` |
| Pool partagé | `pool × part ambassadeur / 100` (importo fisso) |

Note sul calcolo:
- La formula è in SQL (051) ed è replicata in `lib/ambassador/ambassadorAdmin.ts` (`proportionalCommission`) per l'esempio live.
- I parametri vengono **storicizzati sulla riga** (`rate_applied`, `max_commission_applied`, `pool_amount_applied`, `pool_ambassador_percent_applied`): cambiare la configurazione non modifica le commissioni esistenti.
- La spedizione è esclusa: si considerano solo subtotale e riduzione.
- Idempotenza: `orders.ambassador_commission_processed` più il vincolo unico `(tenant_id, referred_customer_id)`. **Una sola commissione per invitato, per sempre**, anche dopo un'annullamento.

**Esempio Proportionnelle.** Acquisto minimo 20 €, commission au seuil 5 € (tasso 25 %), plafond 50 €:
- commande da 40 € senza riduzione → commissione 10 €;
- commande da 20 € con 10 % di riduzione (pagato 18 €) → commissione 4,50 €.

Quindi la « commission au seuil » **non è un minimo garantito**: è solo il punto che definisce il tasso.

**Esempio Pool** (configurazione ChloeFood al 05/10/2026). Acquisto minimo 50 €, pool 5 €, 50 %: l'ambassadeur guadagna 2,50 € e l'invitato ha 2,50 € di riduzione, qualunque sia il totale oltre i 50 €.

### 2.4 Interazione con la fidélité (punti)
- L'ambassadeur **non riceve mai punti** per i suoi invitati: lo sponsor ambassadeur viene saltato nel ledger del parrainage.
- L'invitato:
  - sulla 1ª commande riceve i suoi punti normali solo se non gli è stata applicata una riduzione ambassadeur;
  - dalla 2ª commande in poi li riceve solo se « Le client invité gagne des points à partir de sa 2ᵉ commande » (`ambassador_loyalty_from_second_order`) è attivo.

## 3. Configurazione (`Règles du programme`)

Colonne `tenants.ambassador_*`, salvate da `PATCH /api/admin/ambassador/settings` (permesso `tenant_settings.manage`; senza, la sezione è in sola lettura). Il payload completo viene validato da zod (`ambassadorSettingsSchema`) e dagli invarianti di `ambassadorSettingsIssues`. Gli stessi controlli sono mostrati nel form prima del salvataggio:

| Invariante | Perché |
|---|---|
| Achat minimum > 0 | evita la divisione per zero in `process_ambassador_commission_atomic` alla consegna |
| Commission au seuil ≤ achat minimum | il tasso non può superare il 100 % |
| Plafond ≥ commission au seuil | altrimenti l'etichetta « au seuil » mente |
| Riduzione attiva → valore > 0; `PERCENT` ≤ 100; `FIXED` ≤ achat minimum | nessuna riduzione oltre l'ordine |
| Pool > 0 e part 0–100 | senza pool non si crea alcuna commissione, e senza nessun avviso |
| Quota invitato del pool ≤ achat minimum | la riduzione non può superare l'ordine |

Sul comportamento del form:
- I campi della modalità non attiva vengono conservati ma non validati.
- Il cambio di modalità chiede conferma.
- Se la riduzione è disattivata, il suo valore viene salvato a `null`.
- Il « Seuil de versement conseillé » è solo **indicativo**: segnala « Prêt à verser », ma si può versare anche prima.
- Il salvataggio invalida la cache del tenant (`withStorefrontInvalidation(['tenant'])`).
- `/api/admin/tenant` non accetta più i campi ambassadeur: c'è un solo punto di scrittura, quello validato.

## 4. Operazioni admin

| Sezione | Azione | API | Permesso |
|---|---|---|---|
| Règles du programme | Salvare | `PATCH /api/admin/ambassador/settings` | `tenant_settings.manage` |
| À verser | Verser | `POST /api/admin/ambassador/payouts` | `growth.payouts.manage` |
| Ambassadeurs | Retirer le statut | `POST /api/admin/ambassador/demote` | `growth.manage` |
| Nommer un ambassadeur | Ricerca / nomination | `GET /api/admin/ambassador/customers-search`, `POST /api/admin/ambassador/promote` | `growth.manage` |
| Commissions | Filtro / annullamento | `GET /api/admin/ambassador/commissions`, `POST /api/admin/ambassador/commissions/[id]/cancel` | `growth.manage` / `growth.payouts.manage` |

### 4.1 Versare (pagamento manuale)
1. « À verser » elenca ogni ambassadeur che ha commissioni `CONFIRMED`, con saldo, numero di commissioni e destinazione (IBAN mascherato o PayPal).
2. **IBAN e PayPal vengono letti dal server solo per chi ha `growth.payouts.manage`.** Gli altri ruoli non ricevono mai questi dati nella pagina.
3. Un profilo incompleto (manca nome, cognome o metodo di pagamento, cioè `ambassador_profile_completed_at` è nullo) ha il pulsante disabilitato. Anche l'API rifiuta il versamento (409 `PROFILE_INCOMPLETE`). L'ambassadeur completa il profilo da `/compte/ambassadeur`.
4. La finestra « Verser » mostra beneficiario, IBAN/PayPal e importo, tutti copiabili, più una référence precompilata (`Commission ambassadeur <Nom> <AAAA-MM>`). L'admin fa il bonifico e poi conferma con « J'ai effectué le versement ».
5. L'API aggiorna con **un solo update** solo le commissioni mostrate nella finestra (`commissionIds`), filtrate per tenant, ambassadeur e `status = CONFIRMED`.
   - Una commissione già versata o annullata nel frattempo viene ignorata (`skippedCount`) e non viene mai pagata due volte.
   - Se non resta nulla da versare la risposta è 409 `NOTHING_TO_PAY`.

### 4.2 Annullare una commissione
Si usa quando la commande dell'invitato è stata rimborsata o resa dopo la consegna. L'annullamento:
- vale solo per le commissioni `CONFIRMED` (una commissione `PAID` è già stata trasferita: va regolata fuori piattaforma);
- richiede un motivo obbligatorio (≥ 3 caratteri), salvato in `payment_note` come « Annulée : … »;
- è **definitivo**: per via del vincolo unico, quell'invitato non genererà più una commissione.

Il rimborso di un ordine **non** annulla automaticamente la commissione: è una decisione dell'admin.

### 4.3 Nominare / rimuovere
- La nomination è riservata all'admin e il cliente deve avere già un compte. È idempotente: un cliente già ambassadeur conserva la data di nomination.
- « Retirer le statut » chiede conferma e mette `is_ambassador = false`. Effetti:
  - blocca **future** riduzioni e commissioni (entrambe verificano lo stato al momento);
  - le commissioni già create restano dovute e visibili in « À verser ».

## 5. Lato cliente
`/compte/ambassadeur` (solo se `is_ambassador`) mostra:
- il link d'invito;
- gli invitati diretti (solo profondità 1, nessuna commissione multi-livello);
- lo stato della commissione di ciascuno;
- il form del profilo di pagamento (`POST /api/customers/me/ambassador-profile`: nome, cognome, IBAN ≥ 15 caratteri oppure e-mail PayPal; quando è completo valorizza `ambassador_profile_completed_at`).

## 6. Dati e sicurezza
- `ambassador_commissions`: RLS attivo senza policy pubbliche, accesso solo dal service role. Ogni query admin filtra per `tenant_id`.
- Nessun `DELETE`: le commissioni passano solo `CONFIRMED → PAID` o `CONFIRMED → CANCELLED`.
- Cancellazione del compte: un ambassadeur con commissioni `CONFIRMED` richiede una revisione manuale (`unpaid_ambassador_commission`, `lib/privacy`). Bisogna versare o annullare prima. Dopo la cancellazione le FK diventano `null` (104) e la riga resta come « Compte supprimé ».
- Le regole pure stanno in `lib/ambassador/ambassadorAdmin.ts` e sono testate in `tests/unit/ambassadorAdmin.spec.ts`.

## 7. Limiti noti
- L'annullamento non salva autore e data in colonne dedicate (solo il motivo in `payment_note`). Per un audit completo servirebbe una migration.
- Nessun annullamento automatico su rimborso o reso.
- Un cliente che era già registrato prima di ricevere il link non può essere attribuito all'ambassadeur.

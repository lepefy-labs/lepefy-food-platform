# Engineering Hub — sicurezza

Base verificata: `main` @ `1703e3ea`.

## 1. Chi può entrare

| Soggetto | Fase 1 (oggi) |
|---|---|
| Platform Owner | sì |
| Membro IT (ruolo `engineering_member`, scope `platform`) | **no**: ruolo e permessi esistono dopo la 175 ma nessuna membership è assegnata e `MEMBER_ACCESS_ENABLED = false` |
| `tenant_admin`, cassiere, altri ruoli tenant | no |
| Anonimo | 401 |
| Upload dell'indice (GitHub Actions) | solo `POST /api/internal/engineering/ingest` con `ENGINEERING_INGEST_TOKEN` (≥ 32 caratteri, confronto a tempo costante, route disabilitata se assente); mai la chiave service-role; un run chiuso non accetta più righe; solo `main` si attiva |
| Integrazioni macchina | token `lpe_eng_…` con scope (`search`/`read`/`ask`), solo SHA-256 salvato, scadenza ≤ 1 anno, revoca; mai cookie né tenant (AI_RETRIEVAL.md §6) |

Permessi seminati dalla 175: `engineering.view`, `engineering.ai.use` (assegnati al ruolo IT), `engineering.manage`, `engineering.admin` (solo owner; rischio `critical`).

### Perché non si usa `canAdmin()`

`canAdmin()` lascia passare un `tenant_admin` per **qualunque** permesso che non inizi con `platform.`. Le capability `engineering.*` non devono mai essere valutate con esso. `canAccessEngineering()` (`lib/engineering/access.ts`) ammette solo il Platform Owner e, quando abilitato, chi ha un ruolo con scope `platform` che contiene il permesso. Test: un `tenant_admin` con tutti i permessi nell'elenco non passa.

### Apertura ai membri IT (non fatta, richiede approvazione separata)

1. `platform/layout.tsx` oggi redirige tutto ciò che non è `admin_users.role = 'platform_owner'`: va reso consapevole del solo sotto-albero `/admin/platform/engineering` (ammessa una membership con `engineering.view`), lasciando invariato il resto della console piattaforma.
2. `requireEngineeringApi()` va esteso con `canAccessEngineering` e `MEMBER_ACCESS_ENABLED = true`.
3. Ogni pagina e ogni API ricontrolla il permesso (l'interfaccia nascosta non è un controllo).

## 2. Superficie

- Le API del Hub vivranno sotto `/api/admin/platform/engineering/**`, **assenti** da `adminApiPermissions.ts` e `adminRoutePermissions.ts` (test): non c'è mappatura a una capability tenant. Ogni handler chiama `requireEngineeringApi(permission)` (oggi `requirePlatformOwner`).
- Nessun parametro, header o cookie di tenant allarga l'accesso: il Hub non ha tenant.
- Nessuna API tenant espone documentazione tecnica; il Help Center non legge `engineering_*` e viceversa (test statico).

## 3. Dati

- Tabelle `engineering_*`: RLS forzata, nessuna policy, `revoke all` da `public/anon/authenticated/service_role` e poi grant minimi al solo `service_role` (select, insert/update sulle tabelle di snapshot; nessun delete diretto; revisioni e log append-only per trigger). RPC `security definer` con `search_path` fissato, eseguibili solo dal service role.
- **Segreti e dati personali non entrano nell'indice** (INDEXING.md §1). Il contenuto indicizzato è codice e documentazione già nel repository privato; per questo l'accesso al Hub equivale all'accesso al repository.
- Il testo del repository è **dato non fidato** per l'AI (unità C): istruzioni nei commenti o nei documenti non vengono eseguite.

## 4. Minacce considerate

| Minaccia | Mitigazione |
|---|---|
| Un tenant admin legge il codice | guardia solo-owner; nessuna mappa di permessi tenant; RLS senza policy; test di assenza dalle mappe RBAC |
| Segreto committato per errore finisce nell'indice | scansione di contenuto prima dell'estrazione; file escluso per intero; il valore non esce mai; il Hub non estende la superficie del repository ma non la amplia con copie in chiaro |
| Run incompleto o corrotto mostrato come corrente | run scrivibile solo `running`; manifest verificato dal DB; attivazione atomica; lettura solo del run `active` |
| Doppia sincronizzazione concorrente | un solo `running` per repository; chiave di idempotenza del run; timeout 30 min |
| Attivare un branch di PR | `engineering_branch_not_activatable` |
| Riscrittura di revisioni/log | trigger append-only, nessun grant di update/delete |
| Escalation tramite il ruolo IT | permessi `manage`/`admin` non assegnati al ruolo; membership non create dalla migration |

## 5. Rollback

Blocco commentato in coda alla 175 (distrugge solo l'indice tecnico, il ruolo e i permessi `engineering.*`). Spegnere il Hub senza toccare i dati: non esiste ancora una UI; a UI presente basterà rimuovere la voce di navigazione e le route.

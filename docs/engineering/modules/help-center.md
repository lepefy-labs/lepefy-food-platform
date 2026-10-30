---
id: eng-module-help-center
titolo: Help Center
modulo: help-center
categoria: Piattaforma
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/helpCenter/library/initialLibrary.ts, docs/HELP_CENTER.md]
---

# Help Center

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale».

## Scopo

Guide contestuali per gli admin dei tenant e console editoriale della piattaforma (`/admin/platform/knowledge`). Contesto separato dall'Engineering Hub: nessun import reciproco.

## Punti di ingresso

- Libreria iniziale: `apps/storefront/src/lib/helpCenter/library/initialLibrary.ts` (importata solo dal Platform Owner e pubblicata dopo revisione editoriale).
- Livelli: `help_center` (standard) e `help_center_advanced` (riservato, inattivo), risolti solo da `rules.resolveHelpLevel` (sospensione > flag `help_center_disabled` > avanzato > standard).
- Letture dei tenant: RPC di proiezione `help_tenant_*` (solo revisioni pubblicate).

## Invarianti

- Capability `help.view`; mai dipendente da Assistance (nessun import da `lib/support`).
- Contenuto a blocchi strutturati, mai HTML.
- La migration 174 non concede nulla: attivare `help_center` per un tenant o piano richiede l'approvazione esplicita del richiedente.
- Quando cambia un flusso admin vanno controllati i percorsi `watch` delle guide.

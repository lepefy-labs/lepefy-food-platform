---
id: eng-module-assistance
titolo: Assistance
modulo: assistance
categoria: Piattaforma
stato: parziale
owner: Platform Owner
file_monitorati: [apps/storefront/src/lib/support/rules.ts, docs/SMART_ASSISTANCE.md]
---

# Assistance

> Bozza iniziale derivata dalla documentazione di progetto. **Non verificata da una persona**: stato «Parziale».

## Scopo

Richieste e conversazioni fra un negozio e Lepefy, ticket, allegati e notifiche di risposta.

## Punti di ingresso

- Regole e macchina a stati: `apps/storefront/src/lib/support/rules.ts` (speculare alle RPC SQL, con test di parità).
- API negozio `/api/admin/assistance/**` con `supportTenantApi()` (tenant da `getTenant()`, mai dal browser); API console `/api/admin/platform/assistance/**` con `supportPlatformApi()`.

## Invarianti

- Flag di rilascio `support_assistance` (solo piattaforma) e capability `support.use` (migration 163).
- Le tabelle `support_*` hanno RLS forzata senza policy e sono in sola lettura per il service role: ogni scrittura passa da una RPC `support_*` (chiave idempotente, limiti anti-abuso).
- Un negozio legge solo tramite le RPC di proiezione: note interne, file interni, eventi privati, priorità, assegnatario e link GitHub non lo raggiungono mai.
- Gli screenshot stanno nel bucket privato `support-attachments`, tipo dedotto dai byte, letti da una route autorizzata (URL firmato 60 s).

// Archivio minimo su file JSON: una scheda per azienda, storico delle esecuzioni,
// esiti commerciali in un file append-only separato.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { compareIdentity, slugId } from './identity.mjs';

export function emptyStore() { return { version: 1, prospects: [] }; }

export function loadStore(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : emptyStore();
}

export function saveStore(path, store) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
}

const uniq = (list) => [...new Set(list.filter(Boolean))];

function mergeDossier(old, next) {
  const names = uniq([old.name, ...(old.aliases ?? []), next.name, ...(next.aliases ?? [])]);
  const evidence = new Map((old.evidence ?? []).map((e) => [e.url, e]));
  for (const e of next.evidence ?? []) {
    const prev = evidence.get(e.url);
    // stessa URL: vince la verifica più recente, l'id resta quello nuovo
    if (!prev || (e.checkedAt ?? '') >= (prev.checkedAt ?? '')) evidence.set(e.url, e);
  }
  const keptIds = new Set((next.evidence ?? []).map((e) => e.id));
  const merged = [...(next.evidence ?? [])];
  for (const e of evidence.values()) {
    if (merged.some((m) => m.url === e.url)) continue;
    // fonte vista solo in passato: la conserviamo con un id che non collide
    merged.push(keptIds.has(e.id) ? { ...e, id: `old-${e.id}` } : e);
  }
  return {
    ...old, ...next,
    name: next.name,
    aliases: names.filter((n) => n !== next.name),
    phones: uniq([...(old.phones ?? []), ...(next.phones ?? [])]),
    links: { ...(old.links ?? {}), ...(next.links ?? {}), other: uniq([...(old.links?.other ?? []), ...(next.links?.other ?? [])]) },
    evidence: merged,
  };
}

/**
 * Inserisce o aggiorna una scheda. Ritorna { action: 'created'|'updated', id, possibleDuplicates }.
 * Due schede con stesso nome e città ma indirizzi diversi NON vengono fuse: sono segnalate.
 */
export function upsertProspect(store, dossier, evaluation, { runId, today }) {
  let target = null; const possible = [];
  for (const p of store.prospects) {
    const cmp = compareIdentity(p.dossier, dossier);
    if (cmp === 'same' && !target) target = p;
    else if (cmp === 'possible') possible.push(p.id);
  }
  const snapshot = { status: evaluation.status, fit: evaluation.fit.score, entry: evaluation.entry.kind, entryVerified: evaluation.entry.verified };
  if (target) {
    const before = JSON.stringify({ s: target.evaluation.status, f: target.evaluation.fit.score, e: target.evaluation.entry.verified });
    target.dossier = mergeDossier(target.dossier, dossier);
    target.evaluation = evaluation;
    target.lastSeen = today;
    if (!target.runs.includes(runId)) target.runs.push(runId);
    const after = JSON.stringify({ s: snapshot.status, f: snapshot.fit, e: snapshot.entryVerified });
    if (before !== after) target.history.push({ date: today, run: runId, ...snapshot });
    target.possibleDuplicates = uniq([...(target.possibleDuplicates ?? []), ...possible]);
    return { action: 'updated', id: target.id, possibleDuplicates: possible };
  }
  let id = slugId(dossier); let n = 2;
  while (store.prospects.some((p) => p.id === id)) id = `${slugId(dossier)}-${n++}`;
  store.prospects.push({
    id, dossier, evaluation, firstSeen: today, lastSeen: today, runs: [runId],
    history: [{ date: today, run: runId, ...snapshot }], possibleDuplicates: possible,
  });
  return { action: 'created', id, possibleDuplicates: possible };
}

// --- Esiti commerciali ----------------------------------------------------

export const OUTCOME_TYPES = ['contattato', 'introduzione', 'risposta', 'demo', 'rifiuto', 'nessuna_risposta', 'tenant_pagante'];

export function recordOutcome(path, store, { id, type, reason, note, date }) {
  if (!store.prospects.some((p) => p.id === id)) throw new Error(`Prospect sconosciuto: ${id}`);
  if (!OUTCOME_TYPES.includes(type)) throw new Error(`Esito non valido: ${type} (ammessi: ${OUTCOME_TYPES.join(', ')})`);
  if (type === 'rifiuto' && !reason) throw new Error('Un rifiuto richiede il motivo (--reason).');
  const row = { date, id, type, reason: reason ?? null, note: note ?? null };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  return row;
}

export function loadOutcomes(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

/** Conteggi per tappa, per via d'ingresso e per segmento: dove si perde il prospect? */
export function summarizeOutcomes(store, outcomes) {
  const byId = new Map(store.prospects.map((p) => [p.id, p]));
  const stage = {}; const byEntry = {}; const refusals = {};
  for (const o of outcomes) {
    stage[o.type] = (stage[o.type] ?? 0) + 1;
    const p = byId.get(o.id);
    const entry = p?.evaluation.entry.kind ?? 'sconosciuta';
    byEntry[entry] ??= {}; byEntry[entry][o.type] = (byEntry[entry][o.type] ?? 0) + 1;
    if (o.type === 'rifiuto') refusals[o.reason] = (refusals[o.reason] ?? 0) + 1;
  }
  return { stage, byEntry, refusals };
}

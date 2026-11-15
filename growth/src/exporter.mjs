// Shortlist leggibile (Markdown) ed esportabile (CSV, JSON).

const STATUS_LABEL = {
  pronta: 'Pronta da contattare', da_coltivare: 'Da coltivare (manca la via d\'ingresso)',
  non_qualificata: 'Non qualificata', respinta: 'Respinta dal controllo',
};
const ENTRY_LABEL = {
  introduction: 'Presentazione', visit: 'Visita', event: 'Evento', inbound: 'Richiesta in entrata',
  written_channel: 'Canale scritto', none: 'Nessuna',
};
const ORDER = { pronta: 0, da_coltivare: 1, non_qualificata: 2, respinta: 3 };
const PRIO = { A: 0, B: 1, C: 2 };

export function rank(prospects) {
  return [...prospects].sort((a, b) =>
    ORDER[a.evaluation.status] - ORDER[b.evaluation.status]
    || PRIO[a.dossier.priority?.level ?? 'C'] - PRIO[b.dossier.priority?.level ?? 'C']
    || b.evaluation.fit.score - a.evaluation.fit.score);
}

export function funnel(prospects, discovery) {
  const main = prospects.filter((p) => !p.evaluation.separate);
  const qualified = main.filter((p) => ['pronta', 'da_coltivare'].includes(p.evaluation.status));
  return {
    trovate: discovery?.found?.length ?? prospects.length,
    schedate: prospects.length,
    qualificate: qualified.length,
    conViaIngresso: qualified.filter((p) => p.evaluation.status === 'pronta').length,
    segmentiSeparati: prospects.filter((p) => p.evaluation.separate).length,
  };
}

function card(p, n) {
  const d = p.dossier; const ev = p.evaluation;
  const src = (id) => d.evidence.find((e) => e.id === id);
  const lines = [];
  lines.push(`### ${n}. ${d.name} — ${d.city}${d.region ? ` (${d.region})` : ''}`);
  lines.push('');
  lines.push(`- **Stato:** ${STATUS_LABEL[ev.status]} · **Priorità ${d.priority.level}** · confidenza ${ev.confidence} · fit ${ev.fit.score}/100`);
  lines.push(`- **Segmento:** ${d.segment}${d.address ? ` · ${d.address}` : ''}${p.runs?.length ? ` · giri: ${p.runs.join(', ')}` : ''}`);
  if (d.phones?.length) lines.push(`- **Telefoni pubblici dell'attività:** ${d.phones.join(' · ')} (contatto, non via d'ingresso)`);
  lines.push(`- **Fatto verificato:** ${d.verifiedFact.text} (${d.verifiedFact.evidence.map((id) => `[${id}]`).join(' ')})`);
  lines.push(`- **Ipotesi di problema:** ${d.hypothesis.problem}`);
  lines.push(`- **Domanda per confermarla:** ${d.hypothesis.question}`);
  lines.push(`- **Lepefy:** ${d.lepefy.featureIds.join(', ')} — demo: ${d.lepefy.demoFlow}`);
  lines.push(`- **Via d'ingresso:** ${ENTRY_LABEL[ev.entry.kind]}${ev.entry.verified ? ' (verificata)' : ' (non verificata)'}${d.entry.detail ? ` — ${d.entry.detail}` : ''}`);
  if (!ev.entry.verified) lines.push(`  - Perché non è verificata: ${ev.entry.reasons.join(' ')}`);
  lines.push(`- **Prossima azione:** ${d.entry.nextAction}`);
  lines.push(`- **Motivo della priorità:** ${d.priority.reason}`);
  if (ev.fit.notes.length) lines.push(`- **Note sul fit:** ${ev.fit.notes.join(' ')}`);
  if (ev.warnings.length) lines.push(`- **Avvisi del controllo:** ${ev.warnings.join(' ')}`);
  if (d.toVerify.length) lines.push(`- **Ancora da verificare:** ${d.toVerify.join('; ')}`);
  if (p.possibleDuplicates?.length) lines.push(`- **Possibile omonimia con:** ${p.possibleDuplicates.join(', ')} (non fuse: indirizzi diversi)`);
  lines.push('');
  lines.push(`**Messaggio da rivedere** (${d.message.channel}, ${d.message.language}):`);
  lines.push('');
  lines.push(d.message.text.split('\n').map((l) => `> ${l}`).join('\n'));
  lines.push('');
  lines.push('Fonti:');
  for (const e of d.evidence) {
    const check = p.sourceChecks?.[e.url];
    const auto = check ? ` · ricontrollo automatico ${check.at}: ${check.result}` : '';
    lines.push(`- [${e.id}] ${e.url} — ${e.access === 'opened' ? 'aperta' : e.access === 'blocked' ? 'NON accessibile' : 'solo risultato di ricerca'} il ${e.checkedAt} (${e.kind}): ${e.note}${auto}`);
  }
  lines.push('');
  void src;
  return lines.join('\n');
}

export function toMarkdown({ prospects, discovery, run, outcomes }) {
  const ranked = rank(prospects);
  const main = ranked.filter((p) => !p.evaluation.separate);
  const separate = ranked.filter((p) => p.evaluation.separate);
  const f = funnel(prospects, discovery);
  const out = [];
  out.push(`# Shortlist Lepefy Growth — ${run.id}`);
  out.push('');
  out.push(`Area: ${run.config.area} · segmento: ${run.config.segment} · generata il ${run.exportedAt}`);
  out.push('');
  out.push('## Da contattare per primi');
  out.push('');
  const first = main.filter((p) => p.evaluation.status === 'pronta');
  if (!first.length) out.push('Nessuna scheda ha insieme fit e via d\'ingresso verificata.');
  first.forEach((p, i) => out.push(`${i + 1}. **${p.dossier.name}** (${p.dossier.city}) — ${p.dossier.priority.reason} Prossima azione: ${p.dossier.entry.nextAction}`));
  out.push('');
  out.push('## Imbuto');
  out.push('');
  out.push('| Tappa | Numero |');
  out.push('| --- | --- |');
  out.push(`| Attività trovate nella scoperta | ${f.trovate} |`);
  out.push(`| Schede complete verificate | ${f.schedate} |`);
  out.push(`| Qualificate (segmento principale) | ${f.qualificate} |`);
  out.push(`| Con via d'ingresso concreta | ${f.conViaIngresso} |`);
  out.push(`| Segmenti separati | ${f.segmentiSeparati} |`);
  out.push('');
  out.push('## Schede — segmento principale');
  out.push('');
  main.forEach((p, i) => out.push(card(p, i + 1)));
  if (separate.length) {
    out.push('## Segmenti separati (pitch distinto, fuori classifica)');
    out.push('');
    separate.forEach((p, i) => out.push(card(p, i + 1)));
  }
  if (discovery?.found?.length) {
    out.push('## Candidate escluse o non verificate');
    out.push('');
    const withRun = discovery.found.some((x) => x.run);
    out.push(withRun ? '| Attività | Città | Giro | Esito | Motivo |' : '| Attività | Città | Esito | Motivo |');
    out.push(withRun ? '| --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- |');
    for (const c of discovery.found.filter((x) => x.outcome !== 'schedata')) {
      out.push(`| ${c.name} | ${c.city ?? ''} |${withRun ? ` ${c.run ?? ''} |` : ''} ${c.outcome} | ${c.reason} |`);
    }
    out.push('');
  }
  if (outcomes?.length) {
    out.push('## Esiti commerciali registrati');
    out.push('');
    for (const o of outcomes) out.push(`- ${o.date} · ${o.id} · ${o.type}${o.reason ? ` (${o.reason})` : ''}${o.note ? ` — ${o.note}` : ''}`);
    out.push('');
  }
  return out.join('\n');
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

export function toCsv(prospects) {
  const head = ['id', 'nome', 'citta', 'regione', 'segmento', 'telefoni', 'stato', 'priorita', 'fit', 'confidenza', 'via_ingresso', 'via_verificata',
    'fatto_verificato', 'ipotesi', 'domanda', 'funzioni_lepefy', 'demo', 'prossima_azione', 'canale_messaggio', 'messaggio', 'da_verificare', 'fonti', 'ultimo_controllo', 'giri'];
  const rows = rank(prospects).map((p) => {
    const d = p.dossier; const ev = p.evaluation;
    return [p.id, d.name, d.city, d.region, d.segment, (d.phones ?? []).join(' | '), ev.status, d.priority?.level, ev.fit.score, ev.confidence, ev.entry.kind, ev.entry.verified ? 'si' : 'no',
      d.verifiedFact?.text, d.hypothesis?.problem, d.hypothesis?.question, (d.lepefy?.featureIds ?? []).join(' + '), d.lepefy?.demoFlow, d.entry?.nextAction,
      d.message?.channel, d.message?.text, (d.toVerify ?? []).join(' | '), (d.evidence ?? []).map((e) => e.url).join(' | '), p.lastSeen, (p.runs ?? []).join(' | ')].map(csvCell).join(';');
  });
  return `﻿${head.join(';')}\n${rows.join('\n')}\n`;
}

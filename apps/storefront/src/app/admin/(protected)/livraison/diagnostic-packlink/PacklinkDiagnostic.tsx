'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { IconCheck, IconInfoCircle, IconSearch, IconX } from '@tabler/icons-react';
import type { ShippingProvider } from '@lepefy/types';

type ProbeName = 'shipment' | 'tracking' | 'labels';

interface ProbeResult {
  endpoint: string;
  ok: boolean;
  status: number | null;
  statusText: string | null;
  contentType: string | null;
  durationMs: number;
  data: unknown;
  error?: string;
  truncated?: boolean;
}

interface InspectorSuccess {
  available: true;
  reference: string;
  queriedAt: string;
  probes: Record<ProbeName, ProbeResult>;
}

interface InspectorFailure {
  available: false;
  message: string;
}

type InspectorResponse = InspectorSuccess | InspectorFailure;

interface CandidateField {
  source: ProbeName;
  path: string;
  value: string;
}

const PROBE_LABELS: Record<ProbeName, string> = {
  shipment: 'Shipment',
  tracking: 'Tracking',
  labels: 'Labels',
};

const INPUT_CLS =
  'w-full rounded-xl border border-[var(--admin-border)] bg-white px-3.5 py-3 font-mono text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:bg-gray-950 dark:text-gray-100';

const INTERESTING_PATH =
  /(track|parcel|barcode|label|carrier|reference|shipment|awb|code|number|numero|collo)/i;

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectInterestingFields(source: ProbeName, value: unknown): CandidateField[] {
  const fields: CandidateField[] = [];
  const seen = new Set<string>();

  function visit(current: unknown, path: string, depth: number) {
    if (depth > 10 || fields.length >= 80 || current == null) return;

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }

    if (typeof current !== 'object') return;

    Object.entries(current as Record<string, unknown>).forEach(([key, child]) => {
      if (fields.length >= 80) return;
      const childPath = path === '$' ? `$.${key}` : `${path}.${key}`;
      const primitive =
        child === null ||
        typeof child === 'string' ||
        typeof child === 'number' ||
        typeof child === 'boolean';

      if (primitive && INTERESTING_PATH.test(childPath)) {
        const rendered = formatValue(child);
        const dedupeKey = `${source}:${childPath}:${rendered}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          fields.push({
            source,
            path: childPath,
            value: rendered.length > 500 ? `${rendered.slice(0, 500)}…` : rendered,
          });
        }
      }

      if (!primitive) visit(child, childPath, depth + 1);
    });
  }

  visit(value, '$', 0);
  return fields;
}

function prettyJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function StatusBadge({ probe }: { probe: ProbeResult }) {
  if (probe.ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
        <IconCheck size={13} /> HTTP {probe.status}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
      <IconX size={13} /> {probe.status ? `HTTP ${probe.status}` : 'Erreur réseau'}
    </span>
  );
}

export function PacklinkDiagnostic({ shippingProvider }: { shippingProvider: ShippingProvider }) {
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectorSuccess | null>(null);

  const candidates = useMemo(() => {
    if (!result) return [];
    return (Object.entries(result.probes) as Array<[ProbeName, ProbeResult]>)
      .flatMap(([source, probe]) => collectInterestingFields(source, probe.data));
  }, [result]);

  if (shippingProvider !== 'packlink') {
    return (
      <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Ce tenant n&apos;utilise pas Packlink comme provider de livraison. Le diagnostic Packlink
          ne s&apos;applique donc pas.
        </p>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const normalizedReference = reference.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,40}$/.test(normalizedReference)) {
      setError('Saisissez une référence Packlink valide, par exemple IT2026PRC0005858260.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/admin/packlink-inspector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: normalizedReference }),
      });
      const data = await response.json() as InspectorResponse;

      if (!response.ok) {
        setError('message' in data ? data.message : 'Réponse Packlink inattendue.');
        return;
      }
      if ('message' in data) {
        setError(data.message);
        return;
      }

      setResult(data);
    } catch {
      setError('Erreur réseau lors de l’interrogation de Packlink.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/30">
        <div className="flex gap-3">
          <IconInfoCircle size={20} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" />
          <div>
            <p className="text-sm font-semibold text-blue-950 dark:text-blue-100">Diagnostic en lecture seule</p>
            <p className="mt-1 text-sm leading-6 text-blue-800 dark:text-blue-200">
              L&apos;outil appelle Packlink côté serveur avec la clé API du tenant. Il ne modifie
              ni la commande, ni la livraison, ni la base de données, et la clé API n&apos;est jamais
              envoyée au navigateur.
            </p>
          </div>
        </div>
      </section>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:bg-gray-900"
      >
        <label htmlFor="packlink-reference" className="mb-2 block text-sm font-semibold text-gray-900 dark:text-gray-100">
          Référence Packlink
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="packlink-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="IT2026PRC0005858260"
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLS}
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconSearch size={17} />
            {loading ? 'Interrogation…' : 'Interroger Packlink'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Utilisez le « Numéro de référence de la livraison » affiché dans Packlink PRO.
        </p>
        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </form>

      {result && (
        <>
          <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Référence interrogée</p>
                <p className="mt-1 break-all font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {result.reference}
                </p>
              </div>
              <p className="text-xs text-gray-400">
                {new Date(result.queriedAt).toLocaleString('fr-FR')}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.entries(result.probes) as Array<[ProbeName, ProbeResult]>).map(([name, probe]) => (
                <div key={name} className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{PROBE_LABELS[name]}</p>
                    <StatusBadge probe={probe} />
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] leading-5 text-gray-500">{probe.endpoint}</p>
                  <p className="mt-1 text-[11px] text-gray-400">{probe.durationMs} ms</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:bg-gray-900">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Champs pertinents détectés</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                Détection automatique des chemins contenant tracking, parcel, barcode, carrier,
                label, reference, code ou termes proches. Le JSON brut reste la source de vérité.
              </p>
            </div>

            {candidates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3">Chemin JSON</th>
                      <th className="py-2">Valeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((field, index) => (
                      <tr key={`${field.source}-${field.path}-${index}`} className="border-b border-gray-50 dark:border-gray-800/60">
                        <td className="py-2.5 pr-3 font-medium text-gray-700 dark:text-gray-300">
                          {PROBE_LABELS[field.source]}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-gray-500">{field.path}</td>
                        <td className="break-all py-2.5 font-mono text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {field.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400">
                Aucun champ évident n&apos;a été détecté automatiquement. Inspectez les réponses brutes ci-dessous.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Réponses brutes Packlink</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Les réponses sont affichées sans hypothèse sur le schéma afin d&apos;identifier les vrais champs disponibles.
              </p>
            </div>

            {(Object.entries(result.probes) as Array<[ProbeName, ProbeResult]>).map(([name, probe]) => (
              <details
                key={name}
                className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white dark:bg-gray-900"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--admin-surface-subtle)]">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{PROBE_LABELS[name]}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-gray-400">{probe.contentType ?? 'content-type inconnu'}</p>
                  </div>
                  <StatusBadge probe={probe} />
                </summary>
                <div className="border-t border-[var(--admin-border)]">
                  {probe.error && (
                    <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {probe.error}
                    </div>
                  )}
                  {probe.truncated && (
                    <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                      Réponse tronquée à 200 000 caractères pour protéger l&apos;interface d&apos;administration.
                    </div>
                  )}
                  <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words bg-gray-950 p-4 text-xs leading-5 text-gray-100">
                    {prettyJson(probe.data)}
                  </pre>
                </div>
              </details>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

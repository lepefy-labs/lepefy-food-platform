'use client';

import { useState } from 'react';
import {
  IconAlertTriangle, IconBrandGooglePlay, IconCheck, IconDeviceMobile, IconExternalLink, IconLock, IconMail, IconQrcode,
  IconRefresh, IconShieldLock, IconWorldWww,
} from '@tabler/icons-react';
import {
  androidAppEffects, isValidAndroidPackage, parseFingerprints, playStoreListingUrl, type AndroidAppSettings, type AndroidAppStatus,
} from '@/lib/mobileApp/androidApp';

interface ListingCheck { reachable: boolean | null; httpStatus: number | null; checkedAt: string }

const STATUS: Record<AndroidAppStatus, { label: string; className: string }> = {
  none: { label: 'Aucune application', className: 'border-a-border bg-a-surface-2 text-a-text-2' },
  testing: { label: 'En test · non publique', className: 'border-tone-warning-border bg-tone-warning-bg text-tone-warning-fg' },
  public: { label: 'Publique sur Google Play', className: 'border-tone-success-border bg-tone-success-bg text-tone-success-fg' },
};

const card = 'rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm';
const input = 'mt-1.5 min-h-11 w-full rounded-xl border border-a-border-strong bg-a-surface px-3 text-sm';
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-a-border-strong px-4 text-sm font-semibold text-a-text hover:bg-a-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

export default function MobileAppClient({ initial, storefrontUrl }: { initial: AndroidAppSettings; storefrontUrl: string | null }) {
  const [app, setApp] = useState(initial);
  const [packageName, setPackageName] = useState(initial.packageName ?? '');
  const [editingFingerprints, setEditingFingerprints] = useState(false);
  const [fingerprintDraft, setFingerprintDraft] = useState('');
  const [fingerprintConfirmed, setFingerprintConfirmed] = useState(false);
  const [confirming, setConfirming] = useState<'publish' | 'unpublish' | null>(null);
  const [listing, setListing] = useState<ListingCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const effects = androidAppEffects(app.status, app.fingerprints.length > 0);
  const trimmedPackage = packageName.trim();
  const packageChanged = trimmedPackage !== (app.packageName ?? '');
  const packageValid = trimmedPackage === '' || isValidAndroidPackage(trimmedPackage);
  const draftCheck = editingFingerprints ? parseFingerprints(fingerprintDraft) : null;

  async function save(body: Record<string, unknown>, success: string) {
    setBusy(success);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/platform/mobile-app', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) { setMessage({ tone: 'error', text: data.error ?? 'Enregistrement impossible.' }); return false; }
      setApp(data as AndroidAppSettings);
      setPackageName((data as AndroidAppSettings).packageName ?? '');
      setMessage({ tone: 'ok', text: success });
      return true;
    } catch {
      setMessage({ tone: 'error', text: 'Enregistrement impossible.' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function checkListing() {
    setBusy('listing');
    try {
      const response = await fetch('/api/admin/platform/mobile-app/listing', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) setMessage({ tone: 'error', text: data.error ?? 'Vérification impossible.' });
      else setListing(data as ListingCheck);
    } catch {
      setListing({ reachable: null, httpStatus: null, checkedAt: new Date().toISOString() });
    } finally {
      setBusy(null);
    }
  }

  function startFingerprintEdit() {
    setFingerprintDraft(app.fingerprints.join('\n'));
    setFingerprintConfirmed(false);
    setEditingFingerprints(true);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-a-brand-fg">
            <IconShieldLock size={16} /> Platform owner
          </div>
          <h1 className="text-2xl font-semibold text-a-text">Application mobile</h1>
          <p className="mt-1 max-w-2xl text-sm text-a-text-2">
            Application Android (TWA) du tenant. Ces réglages pilotent le QR « /go », le fichier assetlinks.json et le bloc Google Play des emails de paiement.
          </p>
        </div>
        <div className="rounded-xl border border-a-border bg-a-brand-soft px-4 py-3 text-sm text-a-brand-fg">
          <div className="font-semibold">Tenant courant</div>
          <div>{app.tenant.name} <span className="text-a-brand-fg">({app.tenant.slug})</span></div>
        </div>
      </div>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${message.tone === 'ok'
          ? 'border-tone-success-border bg-tone-success-bg text-tone-success-fg'
          : 'border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg'}`}>{message.text}</p>
      )}

      <section className={card} aria-labelledby="mobile-app-state">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="mobile-app-state" className="flex items-center gap-2 font-semibold text-a-text"><IconDeviceMobile size={20} className="text-a-brand-fg" /> État actuel</h2>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS[app.status].className}`}>{STATUS[app.status].label}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Effect icon={<IconQrcode size={18} />} label="QR /go sur Android" value={effects.go} />
          <Effect icon={<IconMail size={18} />} label="Email paiement /card" value={effects.email} />
          <Effect icon={<IconWorldWww size={18} />} label="assetlinks.json" value={effects.assetLinks} />
        </div>
      </section>

      <section className={card} aria-labelledby="mobile-app-config">
        <h2 id="mobile-app-config" className="font-semibold text-a-text">Configuration</h2>
        <label className="mt-4 block text-sm font-medium text-a-text-2">
          Package Android
          <input value={packageName} onChange={(e) => setPackageName(e.target.value)} disabled={app.isPublic} placeholder="com.exemple.boutique"
            spellCheck={false} autoCapitalize="none" aria-describedby="package-hint" className={`${input} font-mono disabled:bg-a-surface-2 disabled:text-a-text-3`} />
        </label>
        <p id="package-hint" className={`mt-1.5 text-xs ${packageValid ? 'text-a-text-3' : 'text-tone-danger-fg'}`}>
          {!packageValid ? 'Format invalide : lettres, chiffres et points, ex. com.exemple.boutique.'
            : app.isPublic ? 'Repassez l’application en test pour changer de package.' : 'Identifiant de l’application sur Google Play.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!packageChanged || !packageValid || busy !== null}
            onClick={() => save({ packageName: trimmedPackage || null }, 'Package enregistré.')}>Enregistrer</button>
          {app.packageName && (
            <a href={playStoreListingUrl(app.packageName)} target="_blank" rel="noopener noreferrer" className={button}>
              <IconExternalLink size={16} /> Voir la fiche Play Store
            </a>
          )}
        </div>

        <div className="mt-6 border-t border-a-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-a-text"><IconLock size={16} /> Empreintes de signature SHA-256</h3>
            {!editingFingerprints && <button type="button" className={button} onClick={startFingerprintEdit}>Modifier les empreintes</button>}
          </div>
          {!editingFingerprints ? (
            app.fingerprints.length ? (
              <ul className="mt-3 space-y-1.5">{app.fingerprints.map((fp) => (
                <li key={fp} className="break-all rounded-lg bg-a-surface-2 px-3 py-2 font-mono text-xs leading-relaxed text-a-text-2">{fp}</li>
              ))}</ul>
            ) : <p className="mt-3 text-sm text-a-text-3">Aucune empreinte : assetlinks.json reste vide.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2 rounded-xl border border-tone-warning-border bg-tone-warning-bg p-3 text-sm text-tone-warning-fg">
                <IconAlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p>La vérification du domaine de l’application (Digital Asset Links) dépend de ces valeurs. Une empreinte erronée ou supprimée fait réapparaître la barre d’adresse dans l’app. Copiez-les depuis Play Console → Intégrité de l’application.</p>
              </div>
              <label className="block text-sm font-medium text-a-text-2">
                Une empreinte par ligne
                <textarea value={fingerprintDraft} onChange={(e) => setFingerprintDraft(e.target.value)} rows={4} spellCheck={false}
                  className={`${input} min-h-28 py-2 font-mono text-xs`} />
              </label>
              {draftCheck && !draftCheck.ok && <p className="text-xs text-tone-danger-fg">{draftCheck.error}</p>}
              <label className="flex items-start gap-2 text-sm text-a-text-2">
                <input type="checkbox" checked={fingerprintConfirmed} onChange={(e) => setFingerprintConfirmed(e.target.checked)} className="mt-1" />
                Je confirme vouloir modifier les empreintes de signature.
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={button} disabled={!fingerprintConfirmed || !draftCheck?.ok || busy !== null}
                  onClick={async () => {
                    if (await save({ fingerprints: { value: fingerprintDraft, confirm: true } }, 'Empreintes enregistrées.')) setEditingFingerprints(false);
                  }}>Enregistrer les empreintes</button>
                <button type="button" className={button} onClick={() => setEditingFingerprints(false)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className={card} aria-labelledby="mobile-app-publish">
        <h2 id="mobile-app-publish" className="flex items-center gap-2 font-semibold text-a-text"><IconBrandGooglePlay size={20} className="text-a-brand-fg" /> Publication</h2>
        {app.status === 'none' ? (
          <p className="mt-3 text-sm text-a-text-3">Enregistrez d’abord le package Android.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className={button} disabled={busy !== null} onClick={checkListing}>
                <IconRefresh size={16} /> Vérifier la fiche publique
              </button>
              {listing && <ListingResult listing={listing} />}
            </div>

            {confirming === null && (
              <div className="mt-4">
                {app.isPublic ? (
                  <button type="button" className={button} onClick={() => setConfirming('unpublish')}>Repasser en test…</button>
                ) : (
                  <button type="button" onClick={() => setConfirming('publish')}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-a-brand px-4 text-sm font-semibold text-a-on-brand hover:bg-a-brand">
                    Publier l’app aux clients…
                  </button>
                )}
              </div>
            )}

            {confirming && (
              <div className="mt-4 space-y-3 rounded-xl border border-a-border bg-a-brand-soft p-4 text-sm text-a-text">
                <p className="font-semibold">{confirming === 'publish' ? 'Publier l’application aux clients ?' : 'Repasser l’application en test ?'}</p>
                <ul className="list-disc space-y-1 pl-5">
                  {confirming === 'publish' ? (<>
                    <li>Le QR « /go » envoie les téléphones Android vers la fiche Play Store.</li>
                    <li>Les emails de paiement /card affichent le badge Google Play cliquable.</li>
                    <li>Les autres appareils continuent vers {storefrontUrl ?? 'la boutique'}.</li>
                  </>) : (<>
                    <li>Le QR « /go » renvoie tout le monde vers la boutique.</li>
                    <li>Les emails reviennent à « Bientôt disponible sur Google Play ».</li>
                  </>)}
                </ul>
                {confirming === 'publish' && listing?.reachable !== true && (
                  <p className="flex gap-2 rounded-lg border border-tone-warning-border bg-tone-warning-bg p-3 text-tone-warning-fg">
                    <IconAlertTriangle size={18} className="mt-0.5 shrink-0" />
                    {listing?.reachable === false
                      ? `La fiche Play Store n’est pas publique (HTTP ${listing.httpStatus}) : les clients verraient une page « introuvable ».`
                      : 'Fiche Play Store non vérifiée : lancez « Vérifier la fiche publique » avant de publier.'}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-a-brand px-4 text-sm font-semibold text-a-on-brand hover:bg-a-brand disabled:opacity-50"
                    onClick={async () => {
                      const publish = confirming === 'publish';
                      if (await save({ isPublic: publish }, publish ? 'Application publiée : /go et les emails pointent vers Google Play.' : 'Application repassée en test.')) setConfirming(null);
                    }}>{confirming === 'publish' ? 'Confirmer la publication' : 'Confirmer le retour en test'}</button>
                  <button type="button" className={button} onClick={() => setConfirming(null)}>Annuler</button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Effect({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-a-border p-3">
      <p className="flex items-center gap-1.5 text-xs text-a-text-3">{icon}{label}</p>
      <p className="mt-1 text-sm font-medium text-a-text">{value}</p>
    </div>
  );
}

function ListingResult({ listing }: { listing: ListingCheck }) {
  if (listing.reachable) return <span className="flex items-center gap-1 text-sm text-tone-success-fg"><IconCheck size={16} /> Fiche publique accessible</span>;
  if (listing.reachable === false) return <span className="text-sm text-tone-warning-fg">Fiche non accessible au public (HTTP {listing.httpStatus})</span>;
  return <span className="text-sm text-a-text-3">Google Play injoignable, réessayez.</span>;
}

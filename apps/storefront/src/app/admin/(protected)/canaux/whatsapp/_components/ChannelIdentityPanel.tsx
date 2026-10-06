'use client';

import { useState } from 'react';
import { IconShieldLock } from '@tabler/icons-react';
import Button from '../../../../_components/ui/Button';
import CopyableValue from '../../../../_components/ui/CopyableValue';
import type { ChannelView } from '@/lib/whatsapp/adminSchemas';
import { SettingsFeedback, SETTINGS_HINT_CLS, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from '../../../parametres/_components/SettingsUi';
import { useSettingsFeedback } from '../../../parametres/_components/useSettingsFeedback';

type Identity = {
  environment: 'test' | 'production';
  status: 'pending' | 'active' | 'disabled';
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string;
  verified_name: string;
  access_token_env: string;
};

function toIdentity(view: ChannelView | null): Identity {
  return {
    environment: view?.environment ?? 'test',
    status: view?.status ?? 'pending',
    waba_id: view?.technical?.wabaId ?? '',
    phone_number_id: view?.technical?.phoneNumberId ?? '',
    display_phone_number: view?.displayPhoneNumber ?? '',
    verified_name: view?.verifiedName ?? '',
    access_token_env: view?.technical?.accessTokenEnv ?? '',
  };
}

/**
 * Identité Meta du numéro — platform owner uniquement (l'API vérifie aussi).
 * Aucun jeton n'est saisi ici : uniquement le NOM de la variable serveur.
 */
export default function ChannelIdentityPanel({ initial, webhookUrl, isTestTenant }: { initial: ChannelView | null; webhookUrl: string; isTestTenant: boolean }) {
  const [form, setForm] = useState<Identity>(() => toIdentity(initial));
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const set = <K extends keyof Identity>(key: K, value: Identity[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    if (form.environment === 'production' && form.status === 'active'
      && !window.confirm('Activer un numéro de PRODUCTION : les clients recevront des réponses automatiques. Continuer ?')) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/whatsapp/channel', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, access_token_env: form.access_token_env || null }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; issues?: string[] };
      if (!response.ok) throw new Error([body.error, ...(body.issues ?? [])].filter(Boolean).join(' ') || 'Enregistrement impossible.');
      show('Canal enregistré. Rechargez la page pour voir l’état à jour.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const response = await fetch('/api/admin/whatsapp/channel/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: testTo }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string; code?: string };
      if (!response.ok) throw new Error([body.error, body.code, body.message].filter(Boolean).join(' · ') || 'Envoi impossible.');
      show('Modèle hello_world envoyé.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Envoi impossible.', 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/40 p-5 dark:border-violet-900/60 dark:bg-violet-950/10">
      <div className="mb-3 flex items-center gap-2">
        <IconShieldLock size={18} className="text-violet-700 dark:text-violet-300" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-950 dark:text-white">Connexion Meta (plateforme)</h2>
      </div>
      <p className={SETTINGS_HINT_CLS}>
        Le tenant est résolu uniquement par le <strong>phone_number_id</strong>. Le jeton reste dans une variable serveur
        (vide = <code>META_WHATSAPP_SYSTEM_USER_TOKEN</code>). {isTestTenant ? 'Tenant de test : envois limités à WHATSAPP_TEST_RECIPIENTS.' : ''}
      </p>
      <div className="mt-3">
        <CopyableValue label="URL de rappel (webhook)" value={webhookUrl} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="wa-env" className={SETTINGS_LABEL_CLS}>Environnement</label>
          <select id="wa-env" className={SETTINGS_INPUT_CLS} value={form.environment} onChange={(e) => set('environment', e.target.value as Identity['environment'])}>
            <option value="test">Test (numéro de test Meta)</option>
            <option value="production">Production</option>
          </select>
        </div>
        <div>
          <label htmlFor="wa-status" className={SETTINGS_LABEL_CLS}>Statut</label>
          <select id="wa-status" className={SETTINGS_INPUT_CLS} value={form.status} onChange={(e) => set('status', e.target.value as Identity['status'])}>
            <option value="pending">En test — messages enregistrés, pas d’automatisation</option>
            <option value="active">Actif</option>
            <option value="disabled">Désactivé — événements ignorés</option>
          </select>
        </div>
        <div>
          <label htmlFor="wa-waba" className={SETTINGS_LABEL_CLS}>WABA ID</label>
          <input id="wa-waba" className={SETTINGS_INPUT_CLS} inputMode="numeric" value={form.waba_id} onChange={(e) => set('waba_id', e.target.value)} />
        </div>
        <div>
          <label htmlFor="wa-pnid" className={SETTINGS_LABEL_CLS}>Phone number ID</label>
          <input id="wa-pnid" className={SETTINGS_INPUT_CLS} inputMode="numeric" value={form.phone_number_id} onChange={(e) => set('phone_number_id', e.target.value)} />
        </div>
        <div>
          <label htmlFor="wa-display" className={SETTINGS_LABEL_CLS}>Numéro affiché</label>
          <input id="wa-display" className={SETTINGS_INPUT_CLS} placeholder="+1 555 000 0000" value={form.display_phone_number} onChange={(e) => set('display_phone_number', e.target.value)} />
        </div>
        <div>
          <label htmlFor="wa-name" className={SETTINGS_LABEL_CLS}>Nom vérifié</label>
          <input id="wa-name" className={SETTINGS_INPUT_CLS} value={form.verified_name} onChange={(e) => set('verified_name', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="wa-token-env" className={SETTINGS_LABEL_CLS}>Variable du jeton (optionnel)</label>
          <input id="wa-token-env" className={SETTINGS_INPUT_CLS} placeholder="META_WHATSAPP_LEPEFY_TEST_TOKEN" value={form.access_token_env} onChange={(e) => set('access_token_env', e.target.value.toUpperCase())} />
          <p className={SETTINGS_HINT_CLS}>Nom d’une variable d’environnement Vercel, jamais le jeton lui-même.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={save} loading={saving}>{initial ? 'Mettre à jour' : 'Créer le canal'}</Button>
        <SettingsFeedback feedback={feedback} />
      </div>
      {initial && (
        <div className="mt-5 border-t border-violet-200 pt-4 dark:border-violet-900/60">
          <label htmlFor="wa-test-to" className={SETTINGS_LABEL_CLS}>Envoyer le modèle de test hello_world</label>
          <div className="flex flex-wrap gap-2">
            <input id="wa-test-to" className={`${SETTINGS_INPUT_CLS} max-w-xs`} placeholder="393331234567" inputMode="tel" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <Button variant="outline" onClick={sendTest} loading={testing} disabled={testTo.replace(/\D/g, '').length < 6}>Envoyer</Button>
          </div>
          <p className={SETTINGS_HINT_CLS}>Numéro au format international sans « + ». Avec le numéro de test Meta, il doit figurer dans la liste des destinataires autorisés de l’application.</p>
        </div>
      )}
    </section>
  );
}

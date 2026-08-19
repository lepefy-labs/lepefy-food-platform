'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconPlus, IconUserPlus } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';

export type AdminRole = 'platform_owner' | 'tenant_admin' | 'tenant_cashier';

export interface AdminUserRow {
  id: string;
  email: string;
  role: AdminRole;
  tenantId: string | null;
  tenantName: string | null;
  active: boolean;
  invitedByEmail: string | null;
  createdAt: string;
}

export interface TenantOption {
  id: string;
  name: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const ROLE_LABELS: Record<AdminRole, string> = {
  platform_owner: 'Propriétaire plateforme',
  tenant_admin: 'Administrateur tenant',
  tenant_cashier: 'Caissier',
};

// Palette neutre via les CSS var admin déjà exposées (mêmes classes que le
// badge "Bientôt" de AdminSidebar) — aucune couleur hex, aucune teinte liée
// à un tenant précis (zone admin globale).
const ROLE_BADGE_CLS: Record<AdminRole, string> = {
  platform_owner: 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]',
  tenant_admin: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
  tenant_cashier: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

interface InviteForm {
  email: string;
  role: AdminRole;
  tenantId: string;
}

function emptyForm(defaultTenantId: string): InviteForm {
  return { email: '', role: 'tenant_admin', tenantId: defaultTenantId };
}

interface TeamClientProps {
  admins: AdminUserRow[];
  tenants: TenantOption[];
  currentAdminId: string;
}

export default function TeamClient({ admins, tenants, currentAdminId }: TeamClientProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<InviteForm>(emptyForm(tenants[0]?.id ?? ''));
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  function validateForm(): string | null {
    if (!EMAIL_RE.test(form.email.trim())) {
      return 'Adresse e-mail invalide.';
    }
    if (form.role !== 'platform_owner' && !form.tenantId) {
      return 'Sélectionnez un tenant pour ce rôle.';
    }
    return null;
  }

  async function handleInvite() {
    const validationError = validateForm();
    if (validationError) {
      setInviteError(validationError);
      return;
    }

    setInviteError('');
    setInviteSuccess('');
    setInviting(true);
    try {
      const res = await fetch('/api/admin/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim(),
          role: form.role,
          tenantId: form.role === 'platform_owner' ? null : form.tenantId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error ?? 'Erreur lors de l\'invitation.');
        return;
      }

      setInviteSuccess(
        `Accès admin activé pour ${form.email.trim()}. Connexion possible dès maintenant sur /admin/login via code de vérification par email.`,
      );
      setForm(emptyForm(tenants[0]?.id ?? ''));
      setFormOpen(false);
      router.refresh();
    } catch {
      setInviteError('Erreur lors de l\'invitation.');
    } finally {
      setInviting(false);
    }
  }

  async function handleToggleActive(admin: AdminUserRow) {
    setTogglingId(admin.id);
    try {
      const res = await fetch(`/api/admin/team/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !admin.active }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Erreur');
      }
      showToast(admin.active ? 'Administrateur désactivé' : 'Administrateur réactivé', 'success');
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la mise à jour', 'error');
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <section>
      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rôle</th>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Invité par</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((admin) => {
              const isSelf = admin.id === currentAdminId;
              return (
                <tr key={admin.id} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{admin.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE_CLS[admin.role]}`}>
                      {ROLE_LABELS[admin.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {admin.role === 'platform_owner' ? 'Global' : (admin.tenantName ?? 'Tenant introuvable')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      admin.active
                        ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    }`}>
                      {admin.active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {admin.invitedByEmail ?? '·'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleToggleActive(admin)}
                      disabled={isSelf || togglingId === admin.id}
                      title={isSelf ? 'Vous ne pouvez pas désactiver votre propre compte.' : undefined}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700
                                 text-gray-600 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {admin.active ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {admins.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400 text-sm">
                  Aucun administrateur pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!formOpen && (
        <Button onClick={() => setFormOpen(true)}>
          <IconUserPlus size={16} stroke={1.5} />
          Inviter un admin
        </Button>
      )}

      {formOpen && (
        <div className="border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 max-w-lg">
          <p className="text-xs font-medium text-gray-500 mb-3">Inviter un admin</p>

          <div className="mb-3">
            <label className={LABEL_CLS}>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={INPUT_CLS}
              placeholder="admin@exemple.com"
            />
          </div>

          <div className="mb-3">
            <label className={LABEL_CLS}>Rôle</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })}
              className={INPUT_CLS}
            >
              <option value="platform_owner">Propriétaire plateforme</option>
              <option value="tenant_admin">Administrateur tenant</option>
              <option value="tenant_cashier">Caissier</option>
            </select>
          </div>

          {form.role !== 'platform_owner' && (
            <div className="mb-3">
              <label className={LABEL_CLS}>Tenant</label>
              <select
                value={form.tenantId}
                onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                className={INPUT_CLS}
              >
                <option value="">Sélectionner un tenant</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {inviteError && <p className="text-xs text-red-500 mb-3">{inviteError}</p>}
          {inviteSuccess && <p className="text-xs text-green-600 mb-3">{inviteSuccess}</p>}

          <div className="flex items-center gap-2">
            <Button onClick={handleInvite} loading={inviting}>
              {!inviting && <IconPlus size={14} stroke={1.5} />}
              Envoyer l&apos;invitation
            </Button>
            <button
              onClick={() => { setFormOpen(false); setInviteError(''); }}
              disabled={inviting}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

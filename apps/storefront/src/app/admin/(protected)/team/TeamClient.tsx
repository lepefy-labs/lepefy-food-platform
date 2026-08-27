'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconPlus, IconUserPlus } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  roleCode: string;
  roleName: string;
  tenantId: string | null;
  tenantName: string | null;
  active: boolean;
  profileCompleted: boolean;
  invitedByEmail: string | null;
  createdAt: string;
}

export interface TenantOption { id: string; name: string; }
export interface RoleOption { id: string; code: string; name: string; scope: 'tenant' | 'platform'; isSystem: boolean; }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT_CLS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';
const LABEL_CLS = 'mb-0.5 block text-xs uppercase tracking-wide text-gray-400';

interface InviteForm { email: string; roleId: string; tenantId: string; }

interface TeamClientProps {
  admins: AdminUserRow[];
  tenants: TenantOption[];
  roles: RoleOption[];
  currentAdminId: string;
}

export default function TeamClient({ admins, tenants, roles, currentAdminId }: TeamClientProps) {
  const router = useRouter();
  const defaultRole = roles.find((role) => role.code === 'tenant_admin') ?? roles.find((role) => role.scope === 'tenant') ?? roles[0];
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<InviteForm>({ email: '', roleId: defaultRole?.id ?? '', tenantId: tenants[0]?.id ?? '' });
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const selectedRole = roles.find((role) => role.id === form.roleId);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleInvite() {
    if (!EMAIL_RE.test(form.email.trim())) { setInviteError('Adresse e-mail invalide.'); return; }
    if (!selectedRole) { setInviteError('Sélectionnez un rôle.'); return; }
    if (selectedRole.scope === 'tenant' && !form.tenantId) { setInviteError('Sélectionnez un tenant.'); return; }

    setInviteError(''); setInviting(true);
    try {
      const res = await fetch('/api/admin/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim(), roleId: selectedRole.id, tenantId: selectedRole.scope === 'platform' ? null : form.tenantId }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteError(data.error ?? 'Erreur lors de l’invitation.'); return; }
      showToast('Accès créé. Le profil sera complété au premier login.', 'success');
      setForm({ email: '', roleId: defaultRole?.id ?? '', tenantId: tenants[0]?.id ?? '' });
      setFormOpen(false);
      router.refresh();
    } catch { setInviteError('Erreur lors de l’invitation.'); }
    finally { setInviting(false); }
  }

  async function handleToggleActive(admin: AdminUserRow) {
    setTogglingId(admin.id);
    try {
      const res = await fetch(`/api/admin/team/${admin.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !admin.active }) });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error ?? 'Erreur'); }
      showToast(admin.active ? 'Administrateur désactivé' : 'Administrateur réactivé', 'success');
      router.refresh();
    } catch (err) { showToast(err instanceof Error ? err.message : 'Erreur lors de la mise à jour', 'error'); }
    finally { setTogglingId(null); }
  }

  return (
    <section>
      {toast && <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}

      <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400 dark:border-gray-800"><th className="px-4 py-3 font-medium">Utilisateur</th><th className="px-4 py-3 font-medium">Rôle</th><th className="px-4 py-3 font-medium">Tenant</th><th className="px-4 py-3 font-medium">Profil</th><th className="px-4 py-3 font-medium">Statut</th><th className="px-4 py-3 font-medium"></th></tr></thead>
          <tbody>{admins.map((admin) => { const isSelf = admin.id === currentAdminId; return <tr key={admin.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50"><td className="px-4 py-3"><p className="font-medium text-gray-900 dark:text-gray-100">{admin.displayName}</p><p className="text-xs text-gray-400">{admin.email}</p></td><td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{admin.roleName}</span><p className="mt-1 text-[10px] text-gray-400">{admin.roleCode}</p></td><td className="px-4 py-3 text-gray-500">{admin.tenantName ?? 'Global'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${admin.profileCompleted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{admin.profileCompleted ? 'Complet' : 'À compléter'}</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${admin.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{admin.active ? 'Actif' : 'Inactif'}</span></td><td className="px-4 py-3 text-right"><button onClick={() => handleToggleActive(admin)} disabled={isSelf || togglingId === admin.id} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40">{admin.active ? 'Désactiver' : 'Réactiver'}</button></td></tr>; })}</tbody>
        </table>
      </div>

      {!formOpen && <Button onClick={() => setFormOpen(true)}><IconUserPlus size={16} stroke={1.5} />Inviter un admin</Button>}
      {formOpen && <div className="max-w-lg rounded-lg border border-dashed border-gray-200 p-4 dark:border-gray-700"><p className="mb-3 text-xs font-medium text-gray-500">Créer un accès administrateur</p><div className="mb-3"><label className={LABEL_CLS}>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT_CLS} placeholder="admin@exemple.com" /></div><div className="mb-3"><label className={LABEL_CLS}>Rôle</label><select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} className={INPUT_CLS}>{roles.filter((role) => role.code === 'platform_owner' || role.scope === 'tenant').map((role) => <option key={role.id} value={role.id}>{role.name}{role.isSystem ? ' · système' : ''}</option>)}</select></div>{selectedRole?.scope !== 'platform' && <div className="mb-3"><label className={LABEL_CLS}>Tenant</label><select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} className={INPUT_CLS}><option value="">Sélectionner un tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div>}<p className="mb-3 text-xs text-gray-400">Au premier accès, l’administrateur devra renseigner prénom, nom et nickname.</p>{inviteError && <p className="mb-3 text-xs text-red-500">{inviteError}</p>}<div className="flex items-center gap-2"><Button onClick={handleInvite} loading={inviting}>{!inviting && <IconPlus size={14} stroke={1.5} />}Créer l’accès</Button><button onClick={() => { setFormOpen(false); setInviteError(''); }} disabled={inviting} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 disabled:opacity-50">Annuler</button></div></div>}
    </section>
  );
}

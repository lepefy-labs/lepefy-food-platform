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
const INPUT_CLS = 'w-full rounded-lg border border-a-border bg-a-surface px-3 py-2 text-sm text-a-text focus:border-transparent focus:outline-none focus:ring-2 focus:ring-a-focus';
const LABEL_CLS = 'mb-0.5 block text-xs uppercase tracking-wide text-a-text-3';

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
      {toast && <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{toast.msg}</div>}

      <div className="mb-6 overflow-x-auto rounded-xl border border-a-border bg-a-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-a-border text-left text-xs uppercase tracking-wide text-a-text-3"><th className="px-4 py-3 font-medium">Utilisateur</th><th className="px-4 py-3 font-medium">Rôle</th><th className="px-4 py-3 font-medium">Tenant</th><th className="px-4 py-3 font-medium">Profil</th><th className="px-4 py-3 font-medium">Statut</th><th className="px-4 py-3 font-medium"></th></tr></thead>
          <tbody>{admins.map((admin) => { const isSelf = admin.id === currentAdminId; return <tr key={admin.id} className="border-b border-a-border last:border-0"><td className="px-4 py-3"><p className="font-medium text-a-text">{admin.displayName}</p><p className="text-xs text-a-text-3">{admin.email}</p></td><td className="px-4 py-3"><span className="rounded-full bg-a-hover px-2 py-0.5 text-xs font-medium text-a-text-2">{admin.roleName}</span><p className="mt-1 text-xs text-a-text-3">{admin.roleCode}</p></td><td className="px-4 py-3 text-a-text-3">{admin.tenantName ?? 'Global'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${admin.profileCompleted ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-warning-bg text-tone-warning-fg'}`}>{admin.profileCompleted ? 'Complet' : 'À compléter'}</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${admin.active ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-a-hover text-a-text-3'}`}>{admin.active ? 'Actif' : 'Inactif'}</span></td><td className="px-4 py-3 text-right"><button onClick={() => handleToggleActive(admin)} disabled={isSelf || togglingId === admin.id} className="rounded-lg border border-a-border px-3 py-1.5 text-xs text-a-text-2 disabled:cursor-not-allowed disabled:opacity-40">{admin.active ? 'Désactiver' : 'Réactiver'}</button></td></tr>; })}</tbody>
        </table>
      </div>

      {!formOpen && <Button onClick={() => setFormOpen(true)}><IconUserPlus size={16} stroke={1.5} />Inviter un admin</Button>}
      {formOpen && <div className="max-w-lg rounded-lg border border-dashed border-a-border p-4"><p className="mb-3 text-xs font-medium text-a-text-3">Créer un accès administrateur</p><div className="mb-3"><label className={LABEL_CLS}>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT_CLS} placeholder="admin@exemple.com" /></div><div className="mb-3"><label className={LABEL_CLS}>Rôle</label><select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} className={INPUT_CLS}>{roles.filter((role) => role.code === 'platform_owner' || role.scope === 'tenant').map((role) => <option key={role.id} value={role.id}>{role.name}{role.isSystem ? ' · système' : ''}</option>)}</select></div>{selectedRole?.scope !== 'platform' && <div className="mb-3"><label className={LABEL_CLS}>Tenant</label><select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} className={INPUT_CLS}><option value="">Sélectionner un tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></div>}<p className="mb-3 text-xs text-a-text-3">Au premier accès, l’administrateur devra renseigner prénom, nom et nickname.</p>{inviteError && <p className="mb-3 text-xs text-tone-danger-fg">{inviteError}</p>}<div className="flex items-center gap-2"><Button onClick={handleInvite} loading={inviting}>{!inviting && <IconPlus size={14} stroke={1.5} />}Créer l’accès</Button><button onClick={() => { setFormOpen(false); setInviteError(''); }} disabled={inviting} className="rounded-lg border border-a-border px-3 py-1.5 text-xs text-a-text-3 disabled:opacity-50">Annuler</button></div></div>}
    </section>
  );
}

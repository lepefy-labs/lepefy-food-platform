'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AccessRole {
  id: string;
  code: string;
  name: string;
  description: string;
  scope: 'tenant' | 'platform';
  isSystem: boolean;
  active: boolean;
  permissionKeys: string[];
  userCount: number;
}
export interface AccessPermission {
  key: string;
  module: string;
  label: string;
  description: string;
  riskLevel: 'standard' | 'sensitive' | 'critical';
}
export interface AccessUser { id: string; email: string; displayName: string; }
export interface AccessTenant { id: string; name: string; }
export interface AccessMembership { id: string; userId: string; tenantId: string | null; roleId: string; roleName: string; }

interface Props {
  roles: AccessRole[];
  permissions: AccessPermission[];
  users: AccessUser[];
  tenants: AccessTenant[];
  memberships: AccessMembership[];
}

export default function AccessControlClient({ roles, permissions, users, tenants, memberships }: Props) {
  const router = useRouter();
  const tenantRoles = roles.filter((role) => role.scope === 'tenant');
  const [selectedRoleId, setSelectedRoleId] = useState(tenantRoles[0]?.id ?? '');
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const [draftPermissions, setDraftPermissions] = useState<string[]>(selectedRole?.permissionKeys ?? []);
  const [draftName, setDraftName] = useState(selectedRole?.name ?? '');
  const [draftDescription, setDraftDescription] = useState(selectedRole?.description ?? '');
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', code: '', description: '' });
  const [assignment, setAssignment] = useState({ userId: users[0]?.id ?? '', tenantId: tenants[0]?.id ?? '', roleId: tenantRoles[0]?.id ?? '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, AccessPermission[]>();
    for (const permission of permissions.filter((item) => !item.key.startsWith('platform.'))) {
      const list = map.get(permission.module) ?? [];
      list.push(permission);
      map.set(permission.module, list);
    }
    return [...map.entries()];
  }, [permissions]);

  function selectRole(role: AccessRole) {
    setSelectedRoleId(role.id);
    setDraftPermissions(role.permissionKeys);
    setDraftName(role.name);
    setDraftDescription(role.description);
    setMessage(null);
  }

  async function saveRole() {
    if (!selectedRole || selectedRole.isSystem) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/platform/roles/${selectedRole.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draftName, description: draftDescription, permissionKeys: draftPermissions }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Mise à jour impossible.');
      setMessage({ kind: 'ok', text: 'Rôle mis à jour.' });
      router.refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Erreur.' });
    } finally { setBusy(false); }
  }

  async function createRole() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/admin/platform/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRole),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Création impossible.');
      setCreating(false);
      setNewRole({ name: '', code: '', description: '' });
      setMessage({ kind: 'ok', text: 'Rôle créé. Vous pouvez maintenant lui attribuer des permissions.' });
      router.refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Erreur.' });
    } finally { setBusy(false); }
  }

  async function assignRole() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/admin/platform/memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assignment),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Affectation impossible.');
      setMessage({ kind: 'ok', text: 'Rôle affecté à l’utilisateur.' });
      router.refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Erreur.' });
    } finally { setBusy(false); }
  }

  const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-900';

  return (
    <div className="space-y-6">
      {message && <div className={`rounded-xl px-4 py-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between px-2 pt-1"><h2 className="text-sm font-semibold">Rôles tenant</h2><button onClick={() => setCreating(true)} className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white">+ Créer</button></div>
          <div className="space-y-1.5">
            {tenantRoles.map((role) => <button key={role.id} onClick={() => selectRole(role)} className={`w-full rounded-xl border px-3 py-3 text-left ${selectedRoleId === role.id ? 'border-violet-200 bg-violet-50' : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-gray-900 dark:text-white">{role.name}</span>{role.isSystem && <span className="text-[10px] font-semibold uppercase text-gray-400">Système</span>}</div><p className="mt-1 text-xs text-gray-500">{role.permissionKeys.length} permissions · {role.userCount} utilisateur{role.userCount === 1 ? '' : 's'}</p></button>)}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          {selectedRole ? <>
            <div className="mb-5 border-b border-gray-100 pb-4 dark:border-gray-800"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{selectedRole.name}</h2><p className="text-xs text-gray-400">{selectedRole.code}</p></div>{selectedRole.isSystem && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Rôle système protégé</span>}</div></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-gray-500">Nom<input className={input} disabled={selectedRole.isSystem} value={draftName} onChange={(e) => setDraftName(e.target.value)} /></label><label className="text-xs font-semibold text-gray-500 sm:col-span-2">Description<textarea className={input} disabled={selectedRole.isSystem} rows={2} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} /></label></div>
            <div className="mt-6 space-y-5">{groupedPermissions.map(([module, modulePermissions]) => { const all = modulePermissions.every((permission) => draftPermissions.includes(permission.key)); return <div key={module}><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">{module}</h3>{!selectedRole.isSystem && <button onClick={() => setDraftPermissions(all ? draftPermissions.filter((key) => !modulePermissions.some((permission) => permission.key === key)) : Array.from(new Set([...draftPermissions, ...modulePermissions.map((permission) => permission.key)])))} className="text-xs font-semibold text-violet-600">{all ? 'Tout retirer' : 'Tout sélectionner'}</button>}</div><div className="grid gap-2 sm:grid-cols-2">{modulePermissions.map((permission) => <label key={permission.key} className={`flex gap-3 rounded-xl border p-3 ${draftPermissions.includes(permission.key) ? 'border-violet-200 bg-violet-50/60' : 'border-gray-200'}`}><input type="checkbox" disabled={selectedRole.isSystem} checked={draftPermissions.includes(permission.key)} onChange={(e) => setDraftPermissions(e.target.checked ? [...draftPermissions, permission.key] : draftPermissions.filter((key) => key !== permission.key))} /><span><span className="block text-sm font-medium text-gray-900">{permission.label}</span><span className="mt-0.5 block text-[11px] text-gray-500">{permission.description}</span>{permission.riskLevel !== 'standard' && <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${permission.riskLevel === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{permission.riskLevel === 'critical' ? 'Critique' : 'Sensible'}</span>}</span></label>)}</div></div>; })}</div>
            {!selectedRole.isSystem && <div className="mt-6 flex justify-end"><button disabled={busy} onClick={saveRole} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Enregistrer le rôle</button></div>}
          </> : <p className="text-sm text-gray-500">Sélectionnez un rôle.</p>}
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4"><h2 className="text-sm font-semibold">Affecter un rôle</h2><p className="mt-1 text-xs text-gray-500">Une membership définit le rôle d’un utilisateur dans un tenant. Une nouvelle affectation remplace celle du même tenant.</p></div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]"><select className={input} value={assignment.userId} onChange={(e) => setAssignment({ ...assignment, userId: e.target.value })}>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}</select><select className={input} value={assignment.tenantId} onChange={(e) => setAssignment({ ...assignment, tenantId: e.target.value })}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select><select className={input} value={assignment.roleId} onChange={(e) => setAssignment({ ...assignment, roleId: e.target.value })}>{tenantRoles.filter((role) => role.active && role.code !== 'platform_owner').map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button disabled={busy || !assignment.userId || !assignment.tenantId || !assignment.roleId} onClick={assignRole} className="rounded-xl border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-700 disabled:opacity-50">Affecter</button></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-gray-400"><th className="py-2">Utilisateur</th><th>Tenant</th><th>Rôle</th></tr></thead><tbody>{memberships.filter((membership) => membership.tenantId).map((membership) => { const user = users.find((item) => item.id === membership.userId); const tenant = tenants.find((item) => item.id === membership.tenantId); return <tr key={membership.id} className="border-b border-gray-100 last:border-0"><td className="py-3">{user?.displayName ?? user?.email ?? membership.userId}</td><td>{tenant?.name ?? 'Tenant'}</td><td>{membership.roleName}</td></tr>; })}</tbody></table></div>
      </section>

      {creating && <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Créer un rôle tenant</h2><div className="mt-4 space-y-3"><label className="block text-xs font-semibold text-gray-500">Nom<input className={input} value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} /></label><label className="block text-xs font-semibold text-gray-500">Code<input className={input} value={newRole.code} onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="admin_scanner" /></label><label className="block text-xs font-semibold text-gray-500">Description<textarea className={input} rows={3} value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} /></label></div><div className="mt-5 flex justify-end gap-2"><button onClick={() => setCreating(false)} className="rounded-xl border px-4 py-2 text-sm">Annuler</button><button disabled={busy || !newRole.name || !newRole.code} onClick={createRole} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Créer</button></div></div></div>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Select, Spinner } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { titleCase } from '@/lib/format';
import { api, ApiError } from '@/lib/api';
import '@/features/budget/budget.css';

interface User {
  id: number; name?: string; first_name?: string; last_name?: string; email: string;
  role: string; is_active?: boolean; company_name?: string | null; trade?: string | null;
}

const ROLES = ['user', 'admin', 'superadmin'];

export function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [creating, setCreating] = useState(false);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  function load() {
    setLoading(true);
    api.get<User[]>('/users')
      .then((r) => setUsers(Array.isArray(r) ? r : []))
      .catch((e) => { if (e instanceof ApiError && e.status === 403) setDenied(true); else toast.error(e instanceof Error ? e.message : 'Failed to load users'); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = isAdmin ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Add user</Button> : undefined;

  return (
    <AppShell title="Users" actions={actions}>
      {loading ? (
        <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-8)', justifyContent: 'center' }}><Spinner /> Loading…</div>
      ) : denied ? (
        <EmptyState icon="user" title="Admins only" hint="You need an admin role to view the user directory." />
      ) : users.length === 0 ? (
        <EmptyState icon="user" title="No users" hint="Invite your team to collaborate." action={isAdmin ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Add user</Button> : undefined} />
      ) : (
        <Card style={{ overflow: 'auto' }}>
          <table className="bg-table">
            <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Trade</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const name = u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
                return (
                  <tr key={u.id}>
                    <td><span className="bf-row bf-gap-2"><Avatar name={name} size={24} /> {name}</span></td>
                    <td>{u.email}</td>
                    <td>{u.company_name || '—'}</td>
                    <td>{u.trade ? titleCase(u.trade) : '—'}</td>
                    <td><Badge color={u.role === 'superadmin' || u.role === 'admin' ? 'var(--accent)' : 'var(--slate-500)'} dot>{titleCase(u.role)}</Badge></td>
                    <td>{u.is_active === false ? <Badge color="var(--red-500)" dot>Inactive</Badge> : <Badge color="var(--green-500)" dot>Active</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {creating && <AddUserModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </AppShell>
  );
}

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', password: '', role: 'user', company_name: '', trade: '' });

  async function save() {
    if (!f.first_name || !f.last_name || !f.email || !f.password) return toast.error('Name, email and password are required');
    setSaving(true);
    try {
      await api.post('/users', f);
      toast.success('User added');
      onCreated();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add user'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Add user"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add user'}</Button></>}>
      <div className="bf-col bf-gap-4">
        <div className="bf-row bf-gap-4">
          <Field label="First name"><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
          <Field label="Last name"><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
        </div>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Temporary password"><Input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="They can change it later" /></Field>
        <div className="bf-row bf-gap-4">
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select></Field>
          <Field label="Company"><Input value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
        </div>
        <Field label="Trade"><Input value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} placeholder="e.g. Electrical" /></Field>
      </div>
    </Modal>
  );
}

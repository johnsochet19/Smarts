import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Avatar, Badge, Button, Card, Field, Input, Spinner } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { titleCase } from '@/lib/format';
import { api } from '@/lib/api';
import '@/features/budget/budget.css';

interface Profile {
  id: number; name?: string; first_name?: string; last_name?: string; email: string;
  role: string; phone?: string | null; company_name?: string | null; trade?: string | null;
}

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', company_name: '', trade: '' });

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api.get<Profile>(`/users/${user.id}`)
      .then((p) => {
        setProfile(p);
        setF({
          first_name: p.first_name || '', last_name: p.last_name || '',
          phone: p.phone || '', company_name: p.company_name || '', trade: p.trade || '',
        });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [user, toast]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      const updated = await api.put<Profile>(`/users/${user.id}`, f);
      setProfile(updated);
      toast.success('Profile saved');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save profile'); }
    finally { setSaving(false); }
  }

  const displayName = profile?.name || [f.first_name, f.last_name].filter(Boolean).join(' ') || user?.name || user?.email || 'You';

  return (
    <AppShell title="Settings">
      <div className="bf-col bf-gap-4" style={{ maxWidth: 720 }}>
        {/* Appearance — client-side, always available */}
        <Card pad>
          <div className="bf-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 'var(--weight-semibold)' }}>Appearance</div>
              <div className="bf-muted">Switch between light and dark themes.</div>
            </div>
            <Button variant="secondary" icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggle}>
              {theme === 'dark' ? 'Dark' : 'Light'} theme
            </Button>
          </div>
        </Card>

        {/* Account */}
        <Card pad>
          <div className="bf-row bf-gap-3" style={{ alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <Avatar name={displayName} size={44} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'var(--weight-semibold)' }}>{displayName}</div>
              <div className="bf-muted">{profile?.email || user?.email}</div>
            </div>
            {(profile?.role || user?.role) && (
              <Badge color={isAdmin ? 'var(--accent)' : 'var(--slate-500)'} dot>{titleCase(profile?.role || user?.role || 'user')}</Badge>
            )}
          </div>

          {loading ? (
            <div className="bf-row bf-gap-3 bf-muted" style={{ padding: 'var(--space-6)', justifyContent: 'center' }}><Spinner /> Loading…</div>
          ) : (
            <>
              <div className="bf-row bf-gap-4">
                <Field label="First name"><Input value={f.first_name} disabled={!isAdmin} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
                <Field label="Last name"><Input value={f.last_name} disabled={!isAdmin} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
              </div>
              <div className="bf-row bf-gap-4" style={{ marginTop: 'var(--space-3)' }}>
                <Field label="Phone"><Input value={f.phone} disabled={!isAdmin} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
                <Field label="Company"><Input value={f.company_name} disabled={!isAdmin} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
              </div>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Field label="Trade"><Input value={f.trade} disabled={!isAdmin} onChange={(e) => setF({ ...f, trade: e.target.value })} placeholder="e.g. Electrical" /></Field>
              </div>
              {isAdmin ? (
                <div className="bf-row" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
                  <Button variant="primary" icon="check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
                </div>
              ) : (
                <div className="bf-muted" style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                  Contact an administrator to update your account details.
                </div>
              )}
            </>
          )}
        </Card>

        {/* Security shortcut */}
        <Card pad>
          <div className="bf-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 'var(--weight-semibold)' }}>Security</div>
              <div className="bf-muted">Manage two-factor authentication and your password.</div>
            </div>
            <Button variant="secondary" icon="arrowRight" onClick={() => navigate('/security')}>Open security</Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

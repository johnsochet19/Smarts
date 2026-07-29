import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button, Card, Field, Input, Badge } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase } from '@/lib/format';
import './settings.css';

const ROLES = [
  { role: 'owner', desc: 'Full control of the workspace, billing, and all projects.' },
  { role: 'admin', desc: 'Manage projects, members, and settings; bypass tool-level checks.' },
  { role: 'manager', desc: 'Run projects and assign work; manage most records.' },
  { role: 'member', desc: 'Create and edit records they are given access to.' },
  { role: 'viewer', desc: 'Read-only access to shared projects.' },
];

export function SecurityPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [enabled, setEnabled] = useState(!!user?.mfa_enabled);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true);
    try { setSetup(await api.post('/auth/mfa/setup', {})); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Setup failed'); }
    finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true);
    try {
      await api.post('/auth/mfa/enable', { token: code });
      setEnabled(true); setSetup(null); setCode('');
      toast.success('Two-factor authentication enabled');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Invalid code'); }
    finally { setBusy(false); }
  }
  async function disable() {
    const token = prompt('Enter a current 2FA code to disable');
    if (token == null) return;
    setBusy(true);
    try { await api.post('/auth/mfa/disable', { token }); setEnabled(false); toast.success('Two-factor disabled'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Disable failed'); }
    finally { setBusy(false); }
  }

  return (
    <AppShell title="Security">
      <div style={{ maxWidth: 640 }} className="bf-col bf-gap-4">
        <Card pad>
          <div className="bf-row bf-gap-3" style={{ marginBottom: 'var(--space-3)' }}>
            <span className="bf-empty__icon" style={{ width: 40, height: 40 }}><Icon name="user" size={20} /></span>
            <div>
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <div className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>{user?.email}</div>
            </div>
            <span className="bf-spacer" />
            <Badge color="var(--accent)" dot>{titleCase(user?.role ?? 'member')}</Badge>
          </div>
        </Card>

        <Card pad>
          <div className="bf-row bf-gap-3">
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 'var(--text-md)' }}>Two-factor authentication</h3>
              <p className="bf-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>Require a time-based code (TOTP) from an authenticator app at sign-in.</p>
            </div>
            <Badge color={enabled ? 'var(--green-500)' : 'var(--text-subtle)'} dot>{enabled ? 'On' : 'Off'}</Badge>
          </div>

          {!enabled && !setup && <Button variant="primary" icon="check" onClick={begin} disabled={busy} style={{ marginTop: 'var(--space-4)' }}>Enable 2FA</Button>}
          {enabled && <Button variant="danger" icon="close" onClick={disable} disabled={busy} style={{ marginTop: 'var(--space-4)' }}>Disable 2FA</Button>}

          {setup && (
            <div className="bf-col bf-gap-3" style={{ marginTop: 'var(--space-4)' }}>
              <div className="bf-subtle" style={{ fontSize: 'var(--text-sm)' }}>1. Add this secret to your authenticator app (Google Authenticator, 1Password, Authy…):</div>
              <code className="st-secret">{setup.secret}</code>
              <div className="bf-subtle" style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>Or use this setup URI: {setup.otpauth}</div>
              <Field label="2. Enter the 6-digit code to confirm">
                <Input inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <div className="bf-row bf-gap-2">
                <Button variant="primary" onClick={confirm} disabled={busy || code.length !== 6}>Confirm & enable</Button>
                <Button variant="ghost" onClick={() => { setSetup(null); setCode(''); }}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>

        <Card pad>
          <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--space-3)' }}>Roles &amp; permissions</h3>
          <div className="bf-col bf-gap-2">
            {ROLES.map((r) => (
              <div key={r.role} className="bf-row bf-gap-3" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)' }}>
                <Badge color={user?.role === r.role ? 'var(--accent)' : 'var(--text-subtle)'} dot>{titleCase(r.role)}</Badge>
                <span className="bf-muted" style={{ fontSize: 'var(--text-sm)' }}>{r.desc}</span>
              </div>
            ))}
          </div>
          <p className="bf-subtle" style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-3)' }}>Per-tool project permissions are enforced by the backend; set <code className="bf-mono">DEFAULT_TOOL_PERMISSION=none</code> for deny-by-default.</p>
        </Card>
      </div>
    </AppShell>
  );
}

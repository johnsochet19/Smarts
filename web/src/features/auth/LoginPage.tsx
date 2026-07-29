import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, Input } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useAuth, MfaRequiredError } from '@/lib/auth';
import './login.css';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaStage, setMfaStage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password, mfaStage ? mfaToken : undefined);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfaStage(true);
        setError(mfaStage ? 'Invalid code — try again' : null);
      } else {
        setError(err instanceof Error ? err.message : 'Sign in failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <Card className="login__card" pad>
        <div className="login__brand">
          <span className="login__mark"><Icon name="punch" size={22} /></span>
          <span className="login__name">BuildForge</span>
        </div>
        <h1 className="login__title">Sign in</h1>
        <p className="bf-muted" style={{ marginBottom: 'var(--space-5)' }}>Welcome back. Enter your credentials to continue.</p>
        <form onSubmit={onSubmit} className="bf-col bf-gap-4">
          <Field label="Email">
            <Input type="email" autoComplete="email" required placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={mfaStage} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} disabled={mfaStage} />
          </Field>
          {mfaStage && (
            <Field label="Two-factor code">
              <Input inputMode="numeric" autoFocus autoComplete="one-time-code" placeholder="123456" value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </Field>
          )}
          {error && <div className="login__error"><Icon name="alert" size={15} /> {error}</div>}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? 'Signing in…' : mfaStage ? 'Verify & sign in' : 'Sign in'}</Button>
          {mfaStage && <button type="button" className="bf-btn bf-btn--ghost bf-btn--sm" onClick={() => { setMfaStage(false); setMfaToken(''); setError(null); }}>Back</button>}
        </form>
      </Card>
      <p className="login__foot bf-subtle">BuildForge enterprise platform · rebuilt UI</p>
    </div>
  );
}

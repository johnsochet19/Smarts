import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, clearToken, getToken, API_BASE } from './api';

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  mfa_enabled?: boolean;
}

export class MfaRequiredError extends Error {
  constructor(msg = 'Two-factor code required') { super(msg); this.name = 'MfaRequiredError'; }
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, mfaToken?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.get<User>('/auth/me');
        if (active) setUser(me);
      } catch {
        clearToken();
      } finally {
        if (active) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  async function login(email: string, password: string, mfaToken?: string) {
    // Raw fetch so the global 401 handler doesn't hijack the MFA challenge.
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, token: mfaToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && data && data.mfa_required) throw new MfaRequiredError(data.error);
      throw new Error((data && data.error) || 'Sign in failed');
    }
    setToken(data.token);
    setUser(data.user);
  }

  function logout() {
    clearToken();
    setUser(null);
    window.location.assign('/login');
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

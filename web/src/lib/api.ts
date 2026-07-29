// Typed API client for the BuildForge backend.
// Knows the base URL and attaches the auth token. To survive a backend that is
// down, asleep, or split across two deployments, it holds a list of candidate
// bases and automatically fails over to the next one whenever a request can't
// reach the server (a network/CORS "Failed to fetch"), then locks onto the
// first base that actually responds.

const KNOWN_BASES = [
  'https://scheduler-production-6ac2.up.railway.app/api',
  'https://scheduler-production-f3e1.up.railway.app/api',
];

const CANDIDATE_BASES: string[] = (() => {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return ['http://localhost:4000/api'];
  }
  const env = import.meta.env.VITE_API_BASE
    ? String(import.meta.env.VITE_API_BASE).replace(/\/$/, '')
    : '';
  // Configured base first (if any), then every known base not already listed.
  const list = env ? [env, ...KNOWN_BASES.filter((b) => b !== env)] : [...KNOWN_BASES];
  return list.map((b) => b.replace(/\/$/, ''));
})();

// The base that most recently answered; requests try it first.
let activeBase = CANDIDATE_BASES[0];

/** Current backend base URL (the one last known to respond). */
export function getApiBase(): string {
  return activeBase;
}
/** Kept for compatibility with modules that import a static base (e.g. media URLs). */
export const API_BASE = CANDIDATE_BASES[0];

const TOKEN_KEY = 'bf_token';

export function getToken(): string | null {
  // Accept tokens from the legacy app too, for a smooth migration.
  return (
    localStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem('cpm_token') ||
    localStorage.getItem('token')
  );
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown };

function handleUnauthorized() {
  clearToken();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}

async function readResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : typeof payload === 'string' && payload) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return payload as T;
}

export async function apiFetch<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = {
    ...opts,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  // Try the active base first, then any remaining candidates. A thrown fetch
  // means the server was unreachable (down/asleep/CORS) — fail over to the next.
  // A response (even an HTTP error) means that base is live — lock onto it.
  const order = [activeBase, ...CANDIDATE_BASES.filter((b) => b !== activeBase)];
  let unreachable = 0;
  for (const base of order) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, init);
    } catch {
      unreachable++;
      continue; // network/CORS failure — try the next backend
    }
    activeBase = base;
    return readResponse<T>(res);
  }
  throw new ApiError(
    0,
    unreachable === order.length
      ? 'Can’t reach the BuildForge server — it may be starting up. Please try again in a moment.'
      : 'Network request failed. Please check your connection and try again.',
  );
}

export const api = {
  get: <T>(p: string) => apiFetch<T>(p, { method: 'GET' }),
  post: <T>(p: string, body?: unknown) => apiFetch<T>(p, { method: 'POST', body }),
  put: <T>(p: string, body?: unknown) => apiFetch<T>(p, { method: 'PUT', body }),
  patch: <T>(p: string, body?: unknown) => apiFetch<T>(p, { method: 'PATCH', body }),
  del: <T>(p: string) => apiFetch<T>(p, { method: 'DELETE' }),
};

import { useAuth } from '../features/auth/store';
import type { AuthResult } from '@restaurant/shared';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let refreshing: Promise<boolean> | null = null;
async function rotate() {
  if (sessionStorage.getItem('pos:locked')) return false;
  const response = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!response.ok) {
    useAuth.getState().clear();
    return false;
  }
  const result = (await response.json()) as { data: AuthResult };
  if (sessionStorage.getItem('pos:locked')) return false;
  useAuth.getState().setAuth(result.data);
  return true;
}
export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () =>
      navigator.locks
        ? await navigator.locks.request('pos:refresh', rotate)
        : await rotate())().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}
export async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const token = useAuth.getState().token;
  const response = await fetch('/api/v1' + path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && retry && path !== '/auth/login' && (await refreshSession()))
    return api<T>(path, options, false);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.message || 'The server could not complete this request.',
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()).data as T;
}

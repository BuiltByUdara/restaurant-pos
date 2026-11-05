import { create } from 'zustand';
import type { AuthResult, StaffUser } from '@restaurant/shared';
interface AuthStore {
  user: StaffUser | null;
  token: string | null;
  ready: boolean;
  setAuth: (result: AuthResult) => void;
  clear: () => void;
  finish: () => void;
}
export const useAuth = create<AuthStore>((set) => ({
  user: null,
  token: null,
  ready: false,
  setAuth: (result) => set({ user: result.user, token: result.accessToken, ready: true }),
  clear: () => set({ user: null, token: null, ready: true }),
  finish: () => set({ ready: true }),
}));

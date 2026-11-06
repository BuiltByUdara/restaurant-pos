import { z } from 'zod';

export const roleNames = [
  'Owner',
  'Manager',
  'Cashier',
  'Waiter',
  'Kitchen Staff',
  'Inventory Staff',
] as const;
export const permissions = [
  'dashboard:read',
  'orders:read',
  'orders:write',
  'orders:approve',
  'kitchen:read',
  'kitchen:write',
  'payments:write',
  'refunds:approve',
  'inventory:read',
  'inventory:write',
  'staff:read',
  'staff:write',
  'reports:read',
  'settings:write',
  'menu:read',
  'menu:write',
  'tables:read',
  'tables:write',
  'tables:operate',
] as const;
export type Permission = (typeof permissions)[number];
export type RoleName = (typeof roleNames)[number];
export const rolePermissions: Record<RoleName, readonly Permission[]> = {
  Owner: permissions,
  Manager: permissions.filter((p) => p !== 'settings:write'),
  Cashier: [
    'dashboard:read',
    'orders:read',
    'orders:write',
    'payments:write',
    'menu:read',
    'tables:read',
    'tables:operate',
  ],
  Waiter: ['orders:read', 'orders:write', 'menu:read', 'tables:read', 'tables:operate'],
  'Kitchen Staff': ['kitchen:read', 'kitchen:write', 'menu:read'],
  'Inventory Staff': ['inventory:read', 'inventory:write', 'menu:read'],
};
export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginInput = z.input<typeof loginSchema>;
export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  permissions: Permission[];
}
export interface AuthResult {
  user: StaffUser;
  accessToken: string;
  expiresIn: number;
}
export interface ApiError {
  error: { code: string; message: string; requestId?: string };
}
export * from './configuration.js';

import type { RequestHandler, CookieOptions } from 'express';
import { loginSchema } from '@restaurant/shared';
import type { Config } from '../../config.js';
import type { AuthService } from './service.js';
export function authController(auth: AuthService, config: Config) {
  const cookie: CookieOptions = {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/v1/auth',
  };
  const login: RequestHandler = async (req, res) => {
    const input = loginSchema.parse(req.body);
    const value = await auth.login(input.email, input.password, String(req.id));
    res
      .cookie('pos_refresh', value.refresh, { ...cookie, expires: value.expiresAt })
      .json({ data: value.result });
  };
  const refresh: RequestHandler = async (req, res) => {
    try {
      const value = await auth.refresh(req.cookies.pos_refresh);
      res
        .cookie('pos_refresh', value.refresh, { ...cookie, expires: value.expiresAt })
        .json({ data: value.result });
    } catch (error) {
      res.clearCookie('pos_refresh', cookie);
      throw error;
    }
  };
  const logout: RequestHandler = async (req, res) => {
    await auth.logout(req.cookies.pos_refresh, String(req.id));
    res.clearCookie('pos_refresh', cookie).status(204).end();
  };
  const me: RequestHandler = (req, res) => {
    res.json({ data: req.auth!.user });
  };
  return { login, refresh, logout, me };
}

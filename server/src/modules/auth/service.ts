import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { Types } from 'mongoose';
import type { AuthResult, StaffUser, RoleName, Permission } from '@restaurant/shared';
import type { Config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { Role, User, Session, AuditLog } from './models.js';

const accessSeconds = 300;
const sessionMs = 7 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const unauthorized = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in.');
export async function passwordHash(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}
export function createAuthService(config: Config) {
  const dummyHash = passwordHash(randomBytes(32).toString('hex'));
  async function profile(userId: string): Promise<StaffUser> {
    const user = await User.findOne({ _id: userId, active: true });
    if (!user) throw unauthorized();
    const role = await Role.findById(user.role);
    if (!role) throw unauthorized();
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: role.name as RoleName,
      permissions: role.permissions as Permission[],
    };
  }
  function access(user: StaffUser, sessionId: string): AuthResult {
    return {
      user,
      expiresIn: accessSeconds,
      accessToken: jwt.sign({ sid: sessionId }, config.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: accessSeconds,
        subject: user.id,
        issuer: 'restaurant-pos',
        audience: 'restaurant-staff',
      }),
    };
  }
  async function login(email: string, password: string, requestId: string) {
    const user = await User.findOne({ email }).select('+passwordHash');
    const valid = await argon2.verify(user?.passwordHash ?? (await dummyHash), password);
    if (!user || !valid || !user.active)
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const token = randomBytes(48).toString('base64url');
    const session = await Session.create({
      user: user._id,
      currentHash: hash(token),
      expiresAt: new Date(Date.now() + sessionMs),
    });
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    await AuditLog.create({
      actor: user._id,
      action: 'auth.login',
      entityId: session.id,
      requestId,
    });
    return {
      result: access(await profile(user.id), session.id),
      refresh: `${session.id}.${token}`,
      expiresAt: session.expiresAt,
    };
  }
  async function refresh(raw: string | undefined) {
    if (!raw || raw.length > 200) throw unauthorized();
    const [id, secret, ...extra] = raw.split('.');
    if (!Types.ObjectId.isValid(id) || !secret || extra.length) throw unauthorized();
    const incoming = hash(secret);
    const next = randomBytes(48).toString('base64url');
    // One atomic compare-and-swap: only one request can consume a refresh token.
    const session = await Session.findOneAndUpdate(
      { _id: id, currentHash: incoming, revokedAt: null, expiresAt: { $gt: new Date() } },
      {
        $set: { currentHash: hash(next), lastUsedAt: new Date() },
        $push: { usedHashes: incoming },
      },
      { new: true },
    );
    if (!session) {
      // Known consumed token means replay. Revoke this entire session family.
      const replay = await Session.findOneAndUpdate(
        { _id: id, usedHashes: incoming, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      if (replay)
        await AuditLog.create({ actor: replay.user, action: 'auth.refresh_replay', entityId: id });
      throw unauthorized();
    }
    try {
      return {
        result: access(await profile(String(session.user)), id),
        refresh: `${id}.${next}`,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      await Session.updateOne({ _id: id }, { $set: { revokedAt: new Date() } });
      throw error;
    }
  }
  async function authenticate(token: string) {
    try {
      const claims = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'restaurant-pos',
        audience: 'restaurant-staff',
      });
      if (
        typeof claims === 'string' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        !Types.ObjectId.isValid(claims.sub) ||
        !Types.ObjectId.isValid(claims.sid)
      )
        throw unauthorized();
      const active = await Session.exists({
        _id: claims.sid,
        user: claims.sub,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (!active) throw unauthorized();
      return { user: await profile(claims.sub), sessionId: claims.sid };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof jwt.JsonWebTokenError) throw unauthorized();
      throw error;
    }
  }
  async function logout(raw: string | undefined, requestId: string) {
    if (!raw) return;
    const [id, secret] = raw.split('.');
    if (!Types.ObjectId.isValid(id) || !secret) return;
    const h = hash(secret);
    const session = await Session.findOneAndUpdate(
      { _id: id, $or: [{ currentHash: h }, { usedHashes: h }], revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    if (session)
      await AuditLog.create({
        actor: session.user,
        action: 'auth.logout',
        entityId: id,
        requestId,
      });
  }
  return { login, refresh, authenticate, logout };
}
export type AuthService = ReturnType<typeof createAuthService>;

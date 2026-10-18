// Sign-in with a password and a one-time code (Chapter 3, 3.5.1), sessions and role checks.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import { encrypt, decrypt } from './sealed.js';

export const LOCK_AFTER = 5; // wrong passwords before the account is locked
export const LOCK_MINUTES = 15;
const SESSION_HOURS = 8;
const STEP_MINUTES = 5; // time allowed between password and one-time code
export const MIN_PASSWORD = 10;
export const PHONE = /^\+\d{9,15}$/; // international format, e.g. +260971234567 (optional; for SMS, 3.5.10)

// Cost 12 in use; tests lower it with BCRYPT_ROUNDS so the suite runs quickly
export const hashPassword = (password) => bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS ?? 12));

/** Fields of a user that are safe to send to the browser. */
export const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
  entityId: u.entityId, totpEnabled: u.totpEnabled, phone: u.phone ?? null,
  supplierRef: u.supplier?.supplierRef ?? null, companyName: u.supplier?.companyName ?? null,
  fabricIdentity: u.fabricIdentity ?? null,
});

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createAuth({ db, jwtSecret, appKey, issuer = 'ZPPA Transparent Procurement', now = () => new Date() }) {
  const key = Buffer.from(appKey, 'hex');
  if (key.length !== 32) throw new Error('APP_KEY must be 32 bytes as hex (openssl rand -hex 32)');
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

  const sealSecret = (s) => encrypt(Buffer.from(s), key).toString('base64');
  const openSecret = (s) => decrypt(Buffer.from(s, 'base64'), key).toString();
  const token = (sub, purpose, expiresIn, extra = {}) => jwt.sign({ sub, purpose, ...extra }, jwtSecret, { expiresIn });

  function readToken(raw, purpose) {
    try {
      const claims = jwt.verify(raw ?? '', jwtSecret);
      if (claims.purpose !== purpose) throw new Error('wrong purpose');
      return claims;
    } catch {
      throw new AuthError(401, purpose === 'session' ? 'Please sign in.' : 'This step has expired. Please sign in again.');
    }
  }

  async function audit(userId, action, detail, ip) {
    await db.auditLog.create({ data: { userId, action, detail, ip } });
  }

  async function session(user, ip) {
    await audit(user.id, 'login.success', null, ip);
    return {
      token: token(user.id, 'session', `${SESSION_HOURS}h`, { role: user.role }),
      user: publicUser(user),
    };
  }

  // A code is accepted once: later codes must come from a later 30-second time step.
  async function checkCode(user, code) {
    if (!/^\d{6}$/.test(code ?? '')) throw new AuthError(400, 'Enter the 6-digit code from your authenticator app.');
    const result = await verifyTotp({
      secret: openSecret(user.totpSecret), token: code, epochTolerance: 30,
      epoch: Math.floor(now().getTime() / 1000),
      ...(user.totpLastStep != null ? { afterTimeStep: user.totpLastStep } : {}),
    });
    if (!result.valid) throw new AuthError(401, 'That code is not valid. Check the time on your phone and try again.');
    return result.timeStep;
  }

  return {
    /** Step 1: email and password. Returns what the user must do next. */
    async login(email, password, ip) {
      const user = await db.user.findUnique({ where: { email: String(email ?? '').trim().toLowerCase() } });
      const generic = new AuthError(401, 'Email or password is incorrect.');
      if (!user) throw generic;
      if (user.lockedUntil && user.lockedUntil > now()) {
        await audit(user.id, 'login.locked', null, ip);
        const until = user.lockedUntil.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        throw new AuthError(423, `Too many failed attempts. Try again after ${until}.`);
      }
      if (!(await bcrypt.compare(String(password ?? ''), user.passwordHash))) {
        const failed = user.failedLogins + 1;
        const lock = failed >= LOCK_AFTER;
        await db.user.update({ where: { id: user.id }, data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(now().getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        } });
        await audit(user.id, lock ? 'login.lockout' : 'login.failed', { failed }, ip);
        throw generic;
      }
      if (user.status !== 'ACTIVE') {
        await audit(user.id, 'login.suspended', null, ip);
        throw new AuthError(403, 'This account is suspended. Contact the system administrator.');
      }
      await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });

      if (user.totpEnabled) {
        return { next: 'code', stepToken: token(user.id, 'code', `${STEP_MINUTES}m`) };
      }
      // First sign-in: set up the authenticator app before anything else
      const secret = generateSecret();
      await db.user.update({ where: { id: user.id }, data: { totpSecret: sealSecret(secret) } });
      const uri = generateURI({ issuer, label: user.email, secret });
      return {
        next: 'setup', stepToken: token(user.id, 'setup', `${STEP_MINUTES}m`),
        otpauthUri: uri, qr: await QRCode.toDataURL(uri), secret,
      };
    },

    /** Step 2 on first sign-in: confirm the authenticator app works, then turn the code on. */
    async confirmSetup(stepToken, code, ip) {
      const { sub } = readToken(stepToken, 'setup');
      const user = await db.user.findUnique({ where: { id: sub } });
      if (!user?.totpSecret || user.status !== 'ACTIVE') throw new AuthError(401, 'Please sign in again.');
      const step = await checkCode(user, code);
      const updated = await db.user.update({ where: { id: user.id }, data: { totpEnabled: true, totpLastStep: step }, include: { supplier: true } });
      await audit(user.id, 'totp.enabled', null, ip);
      return session(updated, ip);
    },

    /** Step 2 on later sign-ins: the one-time code. */
    async verifyCode(stepToken, code, ip) {
      const { sub } = readToken(stepToken, 'code');
      const user = await db.user.findUnique({ where: { id: sub } });
      if (!user?.totpEnabled || user.status !== 'ACTIVE') throw new AuthError(401, 'Please sign in again.');
      let step;
      try {
        step = await checkCode(user, code);
      } catch (err) {
        await audit(user.id, 'totp.failed', null, ip);
        throw err;
      }
      const updated = await db.user.update({ where: { id: user.id }, data: { totpLastStep: step }, include: { supplier: true } });
      return session(updated, ip);
    },

    /** Express middleware: a valid session from an ACTIVE user. Suspension takes effect on the next request. */
    requireAuth: async (req, _res, next) => {
      try {
        const raw = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        const { sub } = readToken(raw, 'session');
        const user = await db.user.findUnique({ where: { id: sub }, include: { supplier: true } });
        if (!user || user.status !== 'ACTIVE' || !user.totpEnabled) throw new AuthError(401, 'Please sign in.');
        req.user = user;
        next();
      } catch (err) {
        next(err);
      }
    },

    requireRole: (...roles) => (req, _res, next) => {
      next(roles.includes(req.user?.role) ? undefined : new AuthError(403, 'Your role does not allow this action.'));
    },

    audit,
  };
}

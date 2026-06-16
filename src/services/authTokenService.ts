import crypto from 'node:crypto';
import type { AdminRole } from '../models/AdminUser';
import type { Permission } from '../config/permissions';

export interface AuthTokenPayload {
  sub: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions: Permission[];
  schoolId: string;
  exp: number;
}

const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64url');

const parseExpirySeconds = (value = '7d') => {
  const match = value.trim().match(/^(\d+)([smhd])$/i);
  if (!match) return 7 * 24 * 60 * 60;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 's') return amount;
  if (unit === 'm') return amount * 60;
  if (unit === 'h') return amount * 60 * 60;
  return amount * 24 * 60 * 60;
};

const jwtSecret = () => {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET must be set');
  }
  return secret;
};

const sign = (input: string) =>
  crypto.createHmac('sha256', jwtSecret()).update(input).digest('base64url');

export const signAuthToken = (payload: Omit<AuthTokenPayload, 'exp'>) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + parseExpirySeconds(process.env.JWT_EXPIRES_IN);
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify({ ...payload, exp }));
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

export const verifyAuthToken = (token: string): AuthTokenPayload => {
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error('Invalid token');
  }

  const expected = sign(`${encodedHeader}.${encodedPayload}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AuthTokenPayload;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
};

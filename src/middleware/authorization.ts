import type { Request, Response, NextFunction } from 'express';
import AdminUser, { type AdminRole } from '../models/AdminUser';
import { HEADMASTER_PERMISSIONS, type Permission } from '../config/permissions';
import { verifyAuthToken } from '../services/authTokenService';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import logger from '../utils/logger';

export interface AuthenticatedDashboardUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions: Permission[];
  schoolId: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedDashboardUser;
    }
  }
}

/**
 * Simple API-key middleware that protects admin/dashboard HTTP routes.
 *
 * All requests to guarded routes must include:
 *   Authorization: Bearer <ADMIN_API_KEY>
 *
 * Set ADMIN_API_KEY in your environment variables.
 * Generate a strong key:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * This is intentionally lightweight — no JWT, no sessions, no database hit.
 * The dashboard is used by school staff over HTTPS; a shared secret is enough
 * for this scale. Upgrade to JWT if you add multi-staff role management.
 */
export const requireApiKey = (req: Request, res: Response, next: NextFunction): void => {
  // Trim to guard against invisible characters (\r, spaces) from copy-paste or Windows line endings
  const apiKey = process.env.ADMIN_API_KEY?.trim();

  if (!apiKey) {
    // Misconfigured server — fail closed, not open
    logger.error('ADMIN_API_KEY is not set — all admin routes are blocked');
    res.status(503).json({ error: 'Service not configured. Contact the administrator.' });
    return;
  }

  const authHeader = req.headers['authorization'];
  const token      = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (!token || token !== apiKey) {
    logger.warn(
      { tokenLen: token?.length, keyLen: apiKey.length, path: req.path },
      'API key mismatch — check for invisible chars or wrong value'
    );
    res.status(401).json({ error: 'Unauthorized. Valid API key required.' });
    return;
  }

  next();
};

const getBearerToken = (req: Request) => {
  const authHeader = req.headers['authorization'];
  return authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
};

const tryDeprecatedApiKeyFallback = (req: Request): boolean => {
  const apiKey = process.env.ADMIN_API_KEY?.trim();
  const token = getBearerToken(req);
  if (!apiKey || !token || token !== apiKey) return false;

  // TODO: Remove ADMIN_API_KEY fallback after dashboard login is stable.
  req.authUser = {
    id: 'legacy-admin-api-key',
    name: 'Legacy Admin',
    email: 'legacy-admin@schoolbridge.local',
    role: 'headmaster',
    permissions: HEADMASTER_PERMISSIONS,
    schoolId: DEFAULT_SCHOOL_ID
  };
  return true;
};

export const authenticateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Unauthorized. Login required.' });
      return;
    }

    if (tryDeprecatedApiKeyFallback(req)) {
      next();
      return;
    }

    const payload = verifyAuthToken(token);
    const user = await AdminUser.findById(payload.sub);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Unauthorized. User is inactive or no longer exists.' });
      return;
    }

    req.authUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      schoolId: user.schoolId
    };
    next();
  } catch (error) {
    logger.warn({ err: error, path: req.path }, 'Dashboard auth failed');
    res.status(401).json({ error: 'Unauthorized. Invalid or expired token.' });
  }
};

export const requirePermission = (permission: Permission) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Unauthorized. Login required.' });
      return;
    }

    if (!req.authUser.permissions.includes(permission)) {
      res.status(403).json({ error: 'Forbidden. Insufficient permission.' });
      return;
    }

    next();
  };

export const requireRole = (role: AdminRole) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Unauthorized. Login required.' });
      return;
    }

    if (req.authUser.role !== role) {
      res.status(403).json({ error: 'Forbidden. Insufficient role.' });
      return;
    }

    next();
  };

/**
 * Middleware that only allows requests from localhost.
 * Useful for debugging endpoints you never want exposed in production.
 */
export const requireLocalhost = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

  if (!isLocal) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }

  next();
};

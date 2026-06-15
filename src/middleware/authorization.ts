import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

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

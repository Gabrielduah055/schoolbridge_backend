import pino from 'pino';

/**
 * Shared application logger.
 *
 * Local development:  pretty-printed, coloured output via pino-pretty
 * Production (Render): JSON lines — works with Render's log filter UI
 *
 * Usage:
 *   import logger from '../utils/logger';
 *   logger.info('Bot started');
 *   logger.warn({ chatId }, 'Account change detected');
 *   logger.error({ err }, 'AuditLog write failed');
 */

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',

    // Redact sensitive fields from all log lines so they never appear in
    // Render's log export or any third-party log service
    redact: {
      paths: [
        'token',
        'apiKey',
        'TELEGRAM_BOT_TOKEN',
        'OPENROUTER_API_KEY',
        'ADMIN_API_KEY',
        'phone',          // individual fields in log objects
        'claimedPhone'
      ],
      censor: '[REDACTED]'
    }
  },
  isDev
    ? pino.transport({
        target:  'pino-pretty',
        options: {
          colorize:        true,
          translateTime:   'SYS:HH:MM:ss',
          ignore:          'pid,hostname',
          messageFormat:   '{msg}'
        }
      })
    : pino.destination(1) // stdout, JSON, no transformation
);

export default logger;

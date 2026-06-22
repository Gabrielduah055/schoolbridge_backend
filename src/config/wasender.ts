const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const WASENDER_PROVIDER = 'wasenderapi';

export const wasenderConfig = {
  token: process.env.WASENDER_API_TOKEN || process.env.WASENDER_TOKEN || '',
  baseUrl: trimTrailingSlash(process.env.WASENDER_BASE_URL || 'https://www.wasenderapi.com'),
  sessionId: process.env.WASENDER_SESSION_ID || '',
  webhookSecret: process.env.WASENDER_WEBHOOK_SECRET || '',
  diagnosticSecret: process.env.WASENDER_DIAGNOSTIC_SECRET || process.env.WASENDER_WEBHOOK_SECRET || ''
};

export const isWasenderConfigured = () => Boolean(wasenderConfig.token);

import { wasenderConfig } from '../../config/wasender';
import { toGhanaE164Phone } from '../../utils/phone';

interface WasenderSendTextArgs {
  to: string;
  text: string;
}

export interface WasenderSendResult {
  providerMessageId: string;
  status: string;
  jid: string;
  raw: Record<string, unknown>;
}

const endpoint = (path: string) => `${wasenderConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

const requireToken = () => {
  if (!wasenderConfig.token) {
    throw new Error('WASENDER_API_TOKEN is not configured');
  }
};

const requestJson = async <T>(path: string, init: RequestInit): Promise<T> => {
  requireToken();

  const response = await fetch(endpoint(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${wasenderConfig.token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body?.message === 'string'
      ? body.message
      : `WasenderAPI request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as T;
};

export const sendWasenderTextMessage = async ({
  to,
  text
}: WasenderSendTextArgs): Promise<WasenderSendResult> => {
  const recipient = toGhanaE164Phone(to);
  if (!recipient) throw new Error('WhatsApp recipient phone is required');

  const raw = await requestJson<Record<string, any>>('/api/send-message', {
    method: 'POST',
    body: JSON.stringify({ to: recipient, text })
  });

  const data = raw.data || raw;
  return {
    providerMessageId: data.msgId?.toString() || data.id?.toString() || '',
    status: data.status?.toString() || (raw.success ? 'sent' : 'unknown'),
    jid: data.jid?.toString() || recipient,
    raw
  };
};

export const getWasenderSessionStatus = async (): Promise<{ status: string; raw: Record<string, unknown> }> => {
  const raw = await requestJson<Record<string, any>>('/api/status', { method: 'GET' });
  return {
    status: raw.status?.toString() || raw.data?.status?.toString() || 'unknown',
    raw
  };
};

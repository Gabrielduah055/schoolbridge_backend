import { Router } from 'express';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import ChannelAccount from '../models/ChannelAccount';
import Conversation from '../models/Conversation';
import DeliveryLog from '../models/DeliveryLog';
import Message from '../models/Message';
import WebhookEvent from '../models/WebhookEvent';
import WhatsAppIdentity from '../models/WhatsAppIdentity';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { WASENDER_PROVIDER, wasenderConfig } from '../config/wasender';
import {
  normalizeWasenderWebhook,
  refreshWhatsAppChannelAccount,
  resolveWhatsAppKnownRole,
  sendWhatsAppText,
  upsertWhatsAppIdentity
} from '../channels/whatsapp/whatsappAdapter';
import { handleIncomingMessage } from '../services/communication/communicationRouter';
import { logDelivery } from '../services/communication/deliveryService';
import { toGhanaE164Phone } from '../utils/phone';
import logger from '../utils/logger';

const router = Router();

const isValidWebhookSecret = (req: Request) => {
  if (!wasenderConfig.webhookSecret) return true;

  const candidates = [
    req.header('x-webhook-signature'),
    req.header('x-wasender-webhook-secret'),
    req.header('x-webhook-secret'),
    req.header('x-wasender-signature'),
    req.query.secret?.toString()
  ].filter(Boolean);

  // WasenderAPI docs do not currently describe a signature header. This optional
  // shared-secret check lets deployments protect the endpoint when configured.
  return candidates.includes(wasenderConfig.webhookSecret);
};

const isValidDiagnosticSecret = (req: Request) => {
  if (!wasenderConfig.diagnosticSecret) return false;

  const candidates = [
    req.header('x-whatsapp-diagnostic-secret'),
    req.header('x-webhook-signature'),
    req.header('x-wasender-webhook-secret'),
    req.header('x-webhook-secret'),
    req.header('x-wasender-signature'),
    req.query.secret?.toString()
  ].filter(Boolean);

  return candidates.includes(wasenderConfig.diagnosticSecret);
};

const markWebhookEvent = async (
  id: Types.ObjectId,
  status: 'processed' | 'failed' | 'ignored',
  errorMessage = ''
) => {
  await WebhookEvent.updateOne(
    { _id: id },
    {
      $set: {
        status,
        processedAt: new Date(),
        errorMessage
      }
    }
  );
};

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    route: '/api/whatsapp',
    provider: WASENDER_PROVIDER,
    configured: {
      apiToken: Boolean(wasenderConfig.token),
      baseUrl: wasenderConfig.baseUrl,
      sessionId: Boolean(wasenderConfig.sessionId),
      webhookSecret: Boolean(wasenderConfig.webhookSecret),
      diagnosticSecret: Boolean(wasenderConfig.diagnosticSecret)
    }
  });
});

router.get('/diagnostics', async (req: Request, res: Response) => {
  if (!isValidDiagnosticSecret(req)) {
    res.status(403).json({ error: 'Invalid or missing diagnostic secret' });
    return;
  }

  try {
    const [channelAccount, webhookEvents, deliveryLogs, messages, identities] = await Promise.all([
      ChannelAccount.findOne({
        schoolId: DEFAULT_SCHOOL_ID,
        channel: 'whatsapp',
        provider: WASENDER_PROVIDER
      }).sort({ updatedAt: -1 }).lean(),
      WebhookEvent.find({
        schoolId: DEFAULT_SCHOOL_ID,
        channel: 'whatsapp',
        provider: WASENDER_PROVIDER
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('providerEventId eventType status errorMessage processedAt createdAt updatedAt rawPayload')
        .lean(),
      DeliveryLog.find({
        schoolId: DEFAULT_SCHOOL_ID,
        channel: 'whatsapp',
        provider: WASENDER_PROVIDER
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('messageId providerMessageId eventType status errorMessage createdAt rawPayload')
        .lean(),
      Message.find({ channel: 'whatsapp' })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('conversationId direction senderRole status providerMessageId body createdAt sentAt')
        .lean(),
      WhatsAppIdentity.find({})
        .sort({ updatedAt: -1 })
        .limit(10)
        .select('phone normalizedPhone status displayName externalChatId lastInboundAt lastOutboundAt updatedAt')
        .lean()
    ]);

    res.json({
      ok: true,
      configured: {
        apiToken: Boolean(wasenderConfig.token),
        baseUrl: wasenderConfig.baseUrl,
        sessionId: Boolean(wasenderConfig.sessionId),
        webhookSecret: Boolean(wasenderConfig.webhookSecret),
        diagnosticSecret: Boolean(wasenderConfig.diagnosticSecret)
      },
      channelAccount,
      webhookEvents,
      deliveryLogs,
      messages,
      identities
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load WhatsApp diagnostics' });
  }
});

router.post('/test-send', async (req: Request, res: Response) => {
  if (!isValidDiagnosticSecret(req)) {
    res.status(403).json({ error: 'Invalid or missing diagnostic secret' });
    return;
  }

  const to = req.body.to?.toString().trim();
  const text = req.body.text?.toString().trim() || 'SchoolBridge WhatsApp test message';

  if (!to) {
    res.status(400).json({ error: 'to is required' });
    return;
  }

  try {
    const sent = await sendWhatsAppText({ to, text });
    res.json({ ok: true, sent });
  } catch (error: any) {
    logger.error({ err: error }, 'WhatsApp test send failed');
    res.status(502).json({
      ok: false,
      error: error?.message || 'WhatsApp test send failed'
    });
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  if (!isValidWebhookSecret(req)) {
    res.status(403).json({ error: 'Invalid webhook secret' });
    return;
  }

  const payload = req.body as Record<string, any>;
  const normalized = normalizeWasenderWebhook(payload);
  let webhookEventId: Types.ObjectId | null = null;

  try {
    const existing = await WebhookEvent.findOne({
      schoolId: DEFAULT_SCHOOL_ID,
      channel: 'whatsapp',
      provider: WASENDER_PROVIDER,
      providerEventId: normalized.providerEventId
    });

    if (existing && ['processed', 'ignored'].includes(existing.status)) {
      res.json({ ok: true, duplicate: true });
      return;
    }

    const webhookEvent = existing ?? await WebhookEvent.create({
      schoolId: DEFAULT_SCHOOL_ID,
      channel: 'whatsapp',
      provider: WASENDER_PROVIDER,
      providerEventId: normalized.providerEventId,
      eventType: normalized.eventType,
      rawPayload: payload,
      status: 'received'
    });
    webhookEventId = webhookEvent._id as Types.ObjectId;

    if (normalized.ignoredReason || !normalized.inbound) {
      await markWebhookEvent(webhookEvent._id as Types.ObjectId, 'ignored', normalized.ignoredReason || 'ignored');
      res.json({ ok: true, ignored: normalized.ignoredReason || 'ignored' });
      return;
    }

    const inbound = normalized.inbound;
    const resolved = await resolveWhatsAppKnownRole(inbound.participantPhone || '');

    await refreshWhatsAppChannelAccount();

    const participantRole = resolved?.role ?? 'visitor';
    await upsertWhatsAppIdentity(inbound, participantRole, resolved?.refs ?? {});
    const response = await handleIncomingMessage(inbound, participantRole);

    if (response.outgoingMessageId) {
      try {
        const sent = await sendWhatsAppText({
          to: toGhanaE164Phone(inbound.participantPhone || '') || inbound.externalChatId,
          text: response.body
        });

        await Message.updateOne(
          { _id: response.outgoingMessageId },
          {
            $set: {
              status: 'sent',
              providerMessageId: sent.providerMessageId,
              sentAt: new Date()
            }
          }
        );

        await logDelivery({
          messageId: response.outgoingMessageId,
          schoolId: inbound.schoolId,
          channel: 'whatsapp',
          provider: WASENDER_PROVIDER,
          providerMessageId: sent.providerMessageId,
          eventType: 'outbound_sent',
          status: 'sent',
          rawPayload: sent.raw
        });
      } catch (error: any) {
        await Message.updateOne(
          { _id: response.outgoingMessageId },
          { $set: { status: 'failed' } }
        );
        await Conversation.updateOne(
          { _id: response.conversationId },
          { $set: { status: 'failed_delivery', lastMessageAt: new Date() } }
        );
        await logDelivery({
          messageId: response.outgoingMessageId,
          schoolId: inbound.schoolId,
          channel: 'whatsapp',
          provider: WASENDER_PROVIDER,
          eventType: 'outbound_failed',
          status: 'failed',
          errorMessage: error?.message || 'WasenderAPI send failed'
        });
        throw error;
      }
    }

    await markWebhookEvent(webhookEvent._id as Types.ObjectId, 'processed');
    res.json({
      ok: true,
      conversationId: response.conversationId,
      handled: resolved ? 'known_replied' : 'visitor_replied'
    });
  } catch (error: any) {
    if (webhookEventId) {
      await markWebhookEvent(
        webhookEventId,
        'failed',
        error?.message || 'WhatsApp webhook processing failed'
      ).catch((markError) => logger.error({ err: markError }, 'Failed to mark WhatsApp webhook event failed'));
    }
    logger.error({ err: error }, 'WhatsApp webhook processing failed');
    res.status(500).json({ error: error?.message || 'WhatsApp webhook processing failed' });
  }
});

export default router;

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import WebhookEvent from '../models/WebhookEvent';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { WASENDER_PROVIDER, wasenderConfig } from '../config/wasender';
import {
  normalizeWasenderWebhook,
  refreshWhatsAppChannelAccount,
  resolveWhatsAppKnownRole,
  sendWhatsAppText,
  upsertWhatsAppIdentity
} from '../channels/whatsapp/whatsappAdapter';
import { openOrCreateConversation, markConversationStatus } from '../services/communication/conversationService';
import { handleIncomingMessage } from '../services/communication/communicationRouter';
import { logDelivery } from '../services/communication/deliveryService';
import { recordIncomingMessage } from '../services/communication/messageService';
import type { ResolvedSender } from '../services/communication/types';
import logger from '../utils/logger';

const router = Router();

const isValidWebhookSecret = (req: Request) => {
  if (!wasenderConfig.webhookSecret) return true;

  const candidates = [
    req.header('x-wasender-webhook-secret'),
    req.header('x-webhook-secret'),
    req.header('x-wasender-signature'),
    req.query.secret?.toString()
  ].filter(Boolean);

  // WasenderAPI docs do not currently describe a signature header. This optional
  // shared-secret check lets deployments protect the endpoint when configured.
  return candidates.includes(wasenderConfig.webhookSecret);
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

const recordUnknownWhatsAppInbound = async (
  inbound: NonNullable<ReturnType<typeof normalizeWasenderWebhook>['inbound']>,
  providerEventObjectId: Types.ObjectId
) => {
  const sender: ResolvedSender = {
    role: 'visitor',
    name: inbound.senderName || 'WhatsApp Visitor',
    phone: inbound.participantPhone || ''
  };

  const conversation = await openOrCreateConversation(inbound, sender);
  const message = await recordIncomingMessage({
    inbound,
    conversationId: conversation._id as Types.ObjectId,
    sender
  });

  await upsertWhatsAppIdentity(inbound, 'visitor');

  await logDelivery({
    messageId: message._id as Types.ObjectId,
    schoolId: inbound.schoolId,
    channel: 'whatsapp',
    provider: WASENDER_PROVIDER,
    providerMessageId: inbound.providerMessageId,
    eventType: 'inbound_unknown_recorded',
    status: 'received',
    rawPayload: {
      webhookEventId: providerEventObjectId.toString(),
      reason: 'unknown_number_no_ai_reply'
    }
  });

  await markConversationStatus(conversation._id.toString(), 'open');
};

router.post('/webhook', async (req: Request, res: Response) => {
  if (!isValidWebhookSecret(req)) {
    res.status(403).json({ error: 'Invalid webhook secret' });
    return;
  }

  const payload = req.body as Record<string, any>;
  const normalized = normalizeWasenderWebhook(payload);

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

    if (normalized.ignoredReason || !normalized.inbound) {
      await markWebhookEvent(webhookEvent._id as Types.ObjectId, 'ignored', normalized.ignoredReason || 'ignored');
      res.json({ ok: true, ignored: normalized.ignoredReason || 'ignored' });
      return;
    }

    const inbound = normalized.inbound;
    const resolved = await resolveWhatsAppKnownRole(inbound.participantPhone || '');

    await refreshWhatsAppChannelAccount();

    if (!resolved) {
      await recordUnknownWhatsAppInbound(inbound, webhookEvent._id as Types.ObjectId);
      await markWebhookEvent(webhookEvent._id as Types.ObjectId, 'processed', 'unknown_number_no_ai_reply');
      res.json({ ok: true, handled: 'unknown_recorded_no_ai_reply' });
      return;
    }

    await upsertWhatsAppIdentity(inbound, resolved.role, resolved.refs);
    const response = await handleIncomingMessage(inbound, resolved.role);

    if (response.outgoingMessageId) {
      try {
        const sent = await sendWhatsAppText({
          to: inbound.participantPhone || inbound.externalChatId,
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
    res.json({ ok: true, conversationId: response.conversationId });
  } catch (error: any) {
    logger.error({ err: error }, 'WhatsApp webhook processing failed');
    res.status(500).json({ error: error?.message || 'WhatsApp webhook processing failed' });
  }
});

export default router;

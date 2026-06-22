import { Types } from 'mongoose';
import ChannelAccount, { type ChannelAccountStatus } from '../../models/ChannelAccount';
import User from '../../models/User';
import WhatsAppIdentity from '../../models/WhatsAppIdentity';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { WASENDER_PROVIDER, wasenderConfig } from '../../config/wasender';
import { findParentByPhone, findTeacherByPhone } from '../../services/verificationService';
import { getPhoneLookupCandidates, normalizePhoneNumber, toGhanaE164Phone } from '../../utils/phone';
import type { NormalizedInboundMessage, ParticipantRole } from '../../services/communication/types';
import { getWasenderSessionStatus, sendWasenderTextMessage } from './wasenderClient';

interface WasenderMessageKey {
  id?: string;
  fromMe?: boolean;
  remoteJid?: string;
  senderPn?: string;
  cleanedSenderPn?: string;
  senderLid?: string;
}

interface NormalizedWhatsAppResult {
  inbound?: NormalizedInboundMessage;
  providerEventId: string;
  eventType: string;
  ignoredReason?: string;
}

const readString = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const extractMessage = (payload: Record<string, any>) => {
  const messages = payload?.data?.messages;
  if (Array.isArray(messages)) return messages[0] || null;
  return messages || payload?.data?.message || payload?.message || null;
};

const extractSenderPhone = (key: WasenderMessageKey, message: Record<string, any>) => {
  const candidate = readString(key.cleanedSenderPn)
    || readString(key.senderPn).split('@')[0]
    || readString(key.remoteJid).split('@')[0]
    || readString(message.from).split('@')[0]
    || readString(message.sender).split('@')[0];

  return normalizePhoneNumber(candidate);
};

const isGroupJid = (jid?: string) => Boolean(jid && jid.includes('@g.us'));

export const normalizeWasenderWebhook = (payload: Record<string, any>): NormalizedWhatsAppResult => {
  const eventType = readString(payload.event) || readString(payload.type) || 'wasender_webhook';
  const message = extractMessage(payload);
  const key = (message?.key || {}) as WasenderMessageKey;
  const providerMessageId = readString(key.id) || readString(message?.id) || `${payload.timestamp || Date.now()}`;
  const providerEventId = `${eventType}:${providerMessageId}`;

  if (!message) {
    return { providerEventId, eventType, ignoredReason: 'no_message_payload' };
  }

  if (key.fromMe || message.fromMe === true) {
    return { providerEventId, eventType, ignoredReason: 'outgoing_or_self_message' };
  }

  if (isGroupJid(key.remoteJid) || eventType.includes('group')) {
    return { providerEventId, eventType, ignoredReason: 'group_message_ignored' };
  }

  const text = readString(message.messageBody)
    || readString(message.text)
    || readString(message.body)
    || readString(message.message?.conversation)
    || readString(message.message?.extendedTextMessage?.text);

  if (!text) {
    return { providerEventId, eventType, ignoredReason: 'non_text_message_ignored' };
  }

  const phone = extractSenderPhone(key, message);
  const externalChatId = readString(key.remoteJid) || toGhanaE164Phone(phone) || phone;

  return {
    providerEventId,
    eventType,
    inbound: {
      schoolId: DEFAULT_SCHOOL_ID,
      channel: 'whatsapp',
      provider: WASENDER_PROVIDER,
      externalChatId,
      externalUserId: readString(key.senderLid) || readString(key.senderPn) || phone,
      text,
      senderName: readString(message.pushName) || readString(message.senderName) || 'WhatsApp User',
      participantPhone: phone,
      providerMessageId,
      rawPayload: payload
    }
  };
};

const findParentUserId = async (phone: string): Promise<Types.ObjectId | undefined> => {
  const candidates = getPhoneLookupCandidates(phone);
  const user = await User.findOne({ phone: { $in: candidates }, role: 'parent' }).select('_id');
  return user?._id as Types.ObjectId | undefined;
};

export const resolveWhatsAppKnownRole = async (
  phone: string
): Promise<{ role: Exclude<ParticipantRole, 'admin' | 'unregistered'>; refs: { parentUserId?: Types.ObjectId; teacherId?: Types.ObjectId } } | null> => {
  const teacher = await findTeacherByPhone(phone);
  if (teacher) {
    return {
      role: 'teacher',
      refs: { teacherId: new Types.ObjectId(teacher.teacherId) }
    };
  }

  const parent = await findParentByPhone(phone);
  if (parent) {
    return {
      role: 'parent',
      refs: { parentUserId: await findParentUserId(phone) }
    };
  }

  return null;
};

export const upsertWhatsAppIdentity = async (
  inbound: NormalizedInboundMessage,
  role: 'parent' | 'teacher' | 'visitor',
  refs: { parentUserId?: Types.ObjectId; teacherId?: Types.ObjectId } = {}
) => {
  const phone = normalizePhoneNumber(inbound.participantPhone || '');

  await WhatsAppIdentity.findOneAndUpdate(
    { externalChatId: inbound.externalChatId },
    {
      $set: {
        externalChatId: inbound.externalChatId,
        externalUserId: inbound.externalUserId,
        phone,
        normalizedPhone: phone,
        status: role,
        parentUserId: refs.parentUserId ?? null,
        teacherId: refs.teacherId ?? null,
        displayName: inbound.senderName,
        isVerifiedContact: role !== 'visitor',
        lastInboundAt: new Date(),
        metadata: {
          provider: WASENDER_PROVIDER,
          providerMessageId: inbound.providerMessageId
        }
      }
    },
    { upsert: true, new: true }
  );
};

export const sendWhatsAppText = sendWasenderTextMessage;

const toChannelAccountStatus = (status: string): ChannelAccountStatus => {
  if (status === 'connected') return 'connected';
  if (status === 'need_scan' || status === 'needs_scan') return 'needs_scan';
  if (status === 'disconnected' || status === 'logged_out' || status === 'expired') return 'disconnected';
  if (status === 'error') return 'error';
  return 'unknown';
};

export const refreshWhatsAppChannelAccount = async () => {
  let status: ChannelAccountStatus = 'unknown';
  let lastError = '';
  let metadata: Record<string, unknown> = {
    sessionId: wasenderConfig.sessionId || undefined,
    configured: Boolean(wasenderConfig.token)
  };

  if (wasenderConfig.token) {
    try {
      const result = await getWasenderSessionStatus();
      status = toChannelAccountStatus(result.status);
      metadata = { ...metadata, statusResponse: result.raw };
    } catch (error: any) {
      status = 'error';
      lastError = error?.message || 'WasenderAPI status check failed';
    }
  }

  return ChannelAccount.findOneAndUpdate(
    {
      schoolId: DEFAULT_SCHOOL_ID,
      channel: 'whatsapp',
      identifier: wasenderConfig.sessionId || WASENDER_PROVIDER
    },
    {
      $setOnInsert: {
        schoolId: DEFAULT_SCHOOL_ID,
        channel: 'whatsapp',
        identifier: wasenderConfig.sessionId || WASENDER_PROVIDER,
        displayName: 'WhatsApp - WasenderAPI'
      },
      $set: {
        provider: WASENDER_PROVIDER,
        status,
        lastError,
        metadata
      }
    },
    { upsert: true, new: true }
  );
};

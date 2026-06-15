import TelegramBot from 'node-telegram-bot-api';
import { Types } from 'mongoose';
import TelegramIdentity from '../../models/TelegramIdentity';
import ChannelAccount from '../../models/ChannelAccount';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { normalizePhoneNumber } from '../../utils/phone';
import type { NormalizedInboundMessage, ParticipantRole } from '../../services/communication/types';

interface TelegramSessionLike {
  phone?: string | null;
  status?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  teacherId?: Types.ObjectId;
}

export const normalizeTelegramMessage = (
  msg: TelegramBot.Message,
  session?: TelegramSessionLike | null
): NormalizedInboundMessage => {
  const from = msg.from;
  const senderName = [from?.first_name, from?.last_name].filter(Boolean).join(' ')
    || session?.firstName
    || from?.username
    || 'Telegram User';

  return {
    schoolId: DEFAULT_SCHOOL_ID,
    channel: 'telegram',
    provider: 'telegram',
    externalChatId: msg.chat.id.toString(),
    externalUserId: from?.id?.toString() ?? '',
    text: msg.text || '',
    senderName,
    participantPhone: session?.phone || undefined,
    providerMessageId: msg.message_id?.toString(),
    rawPayload: msg as unknown as Record<string, unknown>
  };
};

export const upsertTelegramIdentity = async (
  msg: TelegramBot.Message,
  role: Exclude<ParticipantRole, 'admin' | 'unregistered'>,
  phone: string,
  refs: { parentUserId?: Types.ObjectId; teacherId?: Types.ObjectId } = {}
) => {
  const normalizedPhone = normalizePhoneNumber(phone);

  await TelegramIdentity.findOneAndUpdate(
    { chatId: msg.chat.id.toString() },
    {
      $set: {
        chatId: msg.chat.id.toString(),
        telegramUserId: msg.from?.id?.toString() ?? '',
        phone: normalizedPhone,
        status: role === 'visitor' ? 'visitor' : role,
        parentUserId: refs.parentUserId ?? null,
        teacherId: refs.teacherId ?? null,
        firstName: msg.from?.first_name ?? '',
        lastName: msg.from?.last_name ?? '',
        username: msg.from?.username ?? '',
        isVerifiedContact: true
      }
    },
    { upsert: true, new: true }
  );

  await ChannelAccount.findOneAndUpdate(
    {
      schoolId: DEFAULT_SCHOOL_ID,
      channel: 'telegram',
      provider: 'telegram',
      identifier: 'telegram-bot'
    },
    {
      $setOnInsert: {
        schoolId: DEFAULT_SCHOOL_ID,
        channel: 'telegram',
        provider: 'telegram',
        identifier: 'telegram-bot',
        displayName: process.env.SCHOOL_NAME || 'SchoolBridge Telegram Bot'
      },
      $set: {
        status: 'connected',
        lastInboundAt: new Date(),
        lastError: ''
      }
    },
    { upsert: true }
  );
};


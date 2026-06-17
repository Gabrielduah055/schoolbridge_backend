import { Types } from 'mongoose';
import TelegramIdentity, { type ITelegramIdentity } from '../models/TelegramIdentity';
import TelegramSession from '../models/TelegramSession';
import { findParentByPhone } from './verificationService';
import { SESSION_TTL_PARENT_MS } from './sessionService';
import { getPhoneLookupCandidates } from '../utils/phone';
import logger from '../utils/logger';

type TelegramIdentityDocument = ITelegramIdentity & {
  _id: Types.ObjectId;
};

const parentSessionStatuses = ['visitor', 'unverified', 'escalation_pending'] as const;

export const reconcileTelegramIdentityRole = async (
  identity: TelegramIdentityDocument
): Promise<TelegramIdentityDocument> => {
  if (identity.status !== 'visitor' || !identity.phone) {
    return identity;
  }

  const parent = await findParentByPhone(identity.phone);
  if (!parent) {
    return identity;
  }

  await TelegramIdentity.updateOne(
    { _id: identity._id },
    {
      $set: {
        phone: parent.phone,
        status: 'parent',
        parentUserId: null,
        teacherId: null
      }
    }
  );

  await TelegramSession.updateOne(
    {
      chatId: identity.chatId,
      status: { $in: parentSessionStatuses }
    },
    {
      $set: {
        phone: parent.phone,
        status: 'parent',
        expiresAt: new Date(Date.now() + SESSION_TTL_PARENT_MS),
        lastActivityAt: new Date(),
        conversationHistory: []
      }
    }
  );

  identity.phone = parent.phone;
  identity.status = 'parent';
  identity.parentUserId = undefined;
  identity.teacherId = undefined;

  logger.info(
    { chatId: identity.chatId },
    'Telegram visitor identity upgraded to parent after student record match'
  );

  return identity;
};

export const reconcileTelegramIdentityForChat = async (
  chatId: string
): Promise<TelegramIdentityDocument | null> => {
  const identity = await TelegramIdentity.findOne({ chatId }) as TelegramIdentityDocument | null;
  if (!identity) return null;

  return reconcileTelegramIdentityRole(identity);
};

export const findParentTelegramIdentityByPhone = async (
  phone: string
): Promise<TelegramIdentityDocument | null> => {
  const phoneCandidates = getPhoneLookupCandidates(phone);
  const identities = await TelegramIdentity.find({
    phone: { $in: phoneCandidates },
    status: { $in: ['parent', 'visitor'] }
  }).sort({ status: 1, updatedAt: -1 }) as TelegramIdentityDocument[];

  for (const identity of identities) {
    const reconciled = await reconcileTelegramIdentityRole(identity);
    if (reconciled.status === 'parent') {
      return reconciled;
    }
  }

  return null;
};

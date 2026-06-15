import { Types } from 'mongoose';
import DeliveryLog from '../../models/DeliveryLog';
import ChannelAccount from '../../models/ChannelAccount';
import { DEFAULT_SCHOOL_ID } from '../../config/school';

interface LogDeliveryArgs {
  messageId?: Types.ObjectId;
  broadcastId?: Types.ObjectId;
  recipientId?: Types.ObjectId;
  schoolId?: string;
  channel: 'telegram' | 'whatsapp';
  provider: string;
  providerMessageId?: string;
  eventType: string;
  status?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received' | 'unknown';
  errorMessage?: string;
  rawPayload?: Record<string, unknown> | null;
}

export const logDelivery = async ({
  messageId,
  broadcastId,
  recipientId,
  schoolId = DEFAULT_SCHOOL_ID,
  channel,
  provider,
  providerMessageId = '',
  eventType,
  status = 'unknown',
  errorMessage = '',
  rawPayload = null
}: LogDeliveryArgs) => {
  const log = await DeliveryLog.create({
    messageId,
    broadcastId,
    recipientId,
    schoolId,
    channel,
    provider,
    providerMessageId,
    eventType,
    status,
    errorMessage,
    rawPayload
  });

  const timestampField = status === 'received' || eventType === 'inbound_received' ? 'lastInboundAt' : 'lastOutboundAt';
  const identifier = channel === 'telegram' ? 'telegram-bot' : provider;
  const displayName = channel === 'telegram'
    ? process.env.SCHOOL_NAME || 'SchoolBridge Telegram Bot'
    : provider;

  await ChannelAccount.findOneAndUpdate(
    { schoolId, channel, identifier },
    {
      $setOnInsert: {
        schoolId,
        channel,
        identifier,
        displayName
      },
      $set: {
        status: errorMessage ? 'error' : 'connected',
        provider,
        [timestampField]: new Date(),
        lastError: errorMessage
      }
    },
    { upsert: true }
  );

  return log;
};

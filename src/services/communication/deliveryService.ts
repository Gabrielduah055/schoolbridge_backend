import { Types } from 'mongoose';
import DeliveryLog from '../../models/DeliveryLog';
import ChannelAccount from '../../models/ChannelAccount';
import { DEFAULT_SCHOOL_ID } from '../../config/school';

interface LogDeliveryArgs {
  messageId?: Types.ObjectId;
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
    schoolId,
    channel,
    provider,
    providerMessageId,
    eventType,
    status,
    errorMessage,
    rawPayload
  });

  const timestampField = eventType === 'inbound_received' ? 'lastInboundAt' : 'lastOutboundAt';
  await ChannelAccount.findOneAndUpdate(
    { schoolId, channel, provider, identifier: provider },
    {
      $setOnInsert: {
        schoolId,
        channel,
        provider,
        identifier: provider,
        displayName: provider
      },
      $set: {
        status: errorMessage ? 'error' : 'connected',
        [timestampField]: new Date(),
        lastError: errorMessage
      }
    },
    { upsert: true }
  );

  return log;
};


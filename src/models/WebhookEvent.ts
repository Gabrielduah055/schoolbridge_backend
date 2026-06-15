import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IWebhookEvent extends Document {
  schoolId: string;
  channel: 'telegram' | 'whatsapp';
  provider: string;
  providerEventId: string;
  eventType: string;
  rawPayload: Record<string, unknown>;
  processedAt: Date | null;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  errorMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    channel: { type: String, enum: ['telegram', 'whatsapp'], required: true, index: true },
    provider: { type: String, required: true },
    providerEventId: { type: String, default: '' },
    eventType: { type: String, required: true, index: true },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    processedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['received', 'processed', 'failed', 'ignored'],
      default: 'received',
      index: true
    },
    errorMessage: { type: String, default: '' }
  },
  { timestamps: true }
);

WebhookEventSchema.index(
  { schoolId: 1, channel: 1, provider: 1, providerEventId: 1 },
  { unique: true }
);

export default mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);

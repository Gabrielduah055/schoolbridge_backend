import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IDeliveryLog extends Document {
  messageId?: Types.ObjectId;
  schoolId: string;
  channel: 'telegram' | 'whatsapp';
  provider: string;
  providerMessageId: string;
  eventType: string;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received' | 'unknown';
  errorMessage: string;
  rawPayload: Record<string, unknown> | null;
  createdAt: Date;
}

const DeliveryLogSchema = new Schema<IDeliveryLog>(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null, index: true },
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    channel: { type: String, enum: ['telegram', 'whatsapp'], required: true, index: true },
    provider: { type: String, required: true, default: 'telegram' },
    providerMessageId: { type: String, default: '', index: true },
    eventType: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'received', 'unknown'],
      default: 'unknown',
      index: true
    },
    errorMessage: { type: String, default: '' },
    rawPayload: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

DeliveryLogSchema.index({ schoolId: 1, channel: 1, createdAt: -1 });

export default mongoose.model<IDeliveryLog>('DeliveryLog', DeliveryLogSchema);


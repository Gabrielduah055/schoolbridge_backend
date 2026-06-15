import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export type CommunicationChannel = 'telegram' | 'whatsapp';
export type ChannelAccountStatus = 'connected' | 'disconnected' | 'needs_scan' | 'error' | 'unknown';

export interface IChannelAccount extends Document {
  schoolId: string;
  channel: CommunicationChannel;
  provider: string;
  displayName: string;
  identifier: string;
  status: ChannelAccountStatus;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastError: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelAccountSchema = new Schema<IChannelAccount>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    channel: { type: String, enum: ['telegram', 'whatsapp'], required: true, index: true },
    provider: { type: String, required: true, trim: true },
    displayName: { type: String, default: '', trim: true },
    identifier: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'needs_scan', 'error', 'unknown'],
      default: 'unknown',
      index: true
    },
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

ChannelAccountSchema.index({ schoolId: 1, channel: 1, identifier: 1 }, { unique: true });

export default mongoose.model<IChannelAccount>('ChannelAccount', ChannelAccountSchema);


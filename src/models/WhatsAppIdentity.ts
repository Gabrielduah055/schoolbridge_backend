import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWhatsAppIdentity extends Document {
  externalChatId: string;
  externalUserId: string;
  phone: string;
  normalizedPhone: string;
  status: 'parent' | 'teacher' | 'visitor';
  parentUserId?: Types.ObjectId | null;
  teacherId?: Types.ObjectId | null;
  displayName: string;
  isVerifiedContact: boolean;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppIdentitySchema = new Schema<IWhatsAppIdentity>(
  {
    externalChatId: { type: String, required: true, unique: true, index: true },
    externalUserId: { type: String, default: '', index: true },
    phone: { type: String, required: true, index: true },
    normalizedPhone: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['parent', 'teacher', 'visitor'],
      required: true,
      index: true
    },
    parentUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null
    },
    displayName: { type: String, default: '' },
    isVerifiedContact: { type: Boolean, default: false },
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

WhatsAppIdentitySchema.index({ normalizedPhone: 1, status: 1 });

export default mongoose.model<IWhatsAppIdentity>('WhatsAppIdentity', WhatsAppIdentitySchema);

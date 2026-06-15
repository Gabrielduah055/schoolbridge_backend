import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IBroadcast extends Document {
  schoolId: string;
  createdBy?: Types.ObjectId;
  createdByRole: 'teacher' | 'admin';
  audienceType: 'whole_school' | 'class' | 'individual' | 'individual_parent' | 'teachers' | 'parents';
  classId?: Types.ObjectId;
  targetClass: string;
  recipientPhone: string;
  title: string;
  originalText: string;
  draftedText: string;
  approvalStatus: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'partially_failed' | 'failed' | 'cancelled';
  channels: Array<'telegram' | 'whatsapp'>;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const BroadcastSchema = new Schema<IBroadcast>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    createdBy: { type: Schema.Types.ObjectId, default: null, index: true },
    createdByRole: { type: String, enum: ['teacher', 'admin'], required: true },
    audienceType: {
      type: String,
      enum: ['whole_school', 'class', 'individual', 'individual_parent', 'teachers', 'parents'],
      required: true,
      index: true
    },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    targetClass: { type: String, default: '', index: true },
    recipientPhone: { type: String, default: '', index: true },
    title: { type: String, default: '' },
    originalText: { type: String, required: true },
    draftedText: { type: String, default: '' },
    approvalStatus: {
      type: String,
      enum: ['draft', 'pending_approval', 'approved', 'rejected'],
      default: 'draft',
      index: true
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'partial', 'partially_failed', 'failed', 'cancelled'],
      default: 'draft',
      index: true
    },
    channels: [{ type: String, enum: ['telegram', 'whatsapp'] }],
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

BroadcastSchema.index({ schoolId: 1, createdAt: -1 });

export default mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);

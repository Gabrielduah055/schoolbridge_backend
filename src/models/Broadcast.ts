import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IBroadcast extends Document {
  schoolId: string;
  createdBy?: Types.ObjectId;
  createdByRole: 'teacher' | 'admin';
  audienceType: 'whole_school' | 'class' | 'individual' | 'individual_parent' | 'teachers' | 'parents';
  classId?: Types.ObjectId;
  recipientStudentId?: Types.ObjectId;
  recipientStudentName: string;
  targetClass: string;
  recipientPhone: string;
  title: string;
  originalText: string;
  draftedText: string;
  attachments: Array<{
    originalName: string;
    fileName: string;
    filePath: string;
    mimeType: string;
    size: number;
  }>;
  approvalStatus: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'partially_failed' | 'failed' | 'cancelled';
  channels: Array<'telegram' | 'whatsapp'>;
  approvedBy?: Types.ObjectId;
  approvedByName: string;
  approvedAt: Date | null;
  sentBy?: Types.ObjectId;
  sentByName: string;
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
    recipientStudentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    recipientStudentName: { type: String, default: '' },
    targetClass: { type: String, default: '', index: true },
    recipientPhone: { type: String, default: '', index: true },
    title: { type: String, default: '' },
    originalText: { type: String, required: true },
    draftedText: { type: String, default: '' },
    attachments: [
      {
        originalName: { type: String, default: '' },
        fileName: { type: String, default: '' },
        filePath: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 }
      }
    ],
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
    approvedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    approvedByName: { type: String, default: '' },
    approvedAt: { type: Date, default: null },
    sentBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    sentByName: { type: String, default: '' },
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

BroadcastSchema.index({ schoolId: 1, createdAt: -1 });

export default mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);

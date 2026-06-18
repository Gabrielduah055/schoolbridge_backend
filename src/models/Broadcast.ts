import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import type { AdminRole } from './AdminUser';

export type BroadcastActorRole = AdminRole | 'admin' | 'teacher';
export type BroadcastStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'partially_failed'
  | 'failed'
  | 'cancelled';

export interface IBroadcast extends Document {
  schoolId: string;
  createdBy?: Types.ObjectId;
  createdByName: string;
  createdByRole: BroadcastActorRole;
  lastEditedBy?: Types.ObjectId;
  lastEditedByName: string;
  lastEditedByRole: BroadcastActorRole | '';
  lastEditedAt: Date | null;
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
  status: BroadcastStatus;
  channels: Array<'telegram' | 'whatsapp'>;
  approvedBy?: Types.ObjectId;
  approvedByName: string;
  approvedByRole: BroadcastActorRole | '';
  approvedAt: Date | null;
  sentBy?: Types.ObjectId;
  sentByName: string;
  sentByRole: BroadcastActorRole | '';
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const BroadcastSchema = new Schema<IBroadcast>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    createdBy: { type: Schema.Types.ObjectId, default: null, index: true },
    createdByName: { type: String, default: '' },
    createdByRole: {
      type: String,
      enum: ['super_admin', 'headmaster', 'school_admin', 'teacher', 'admin'],
      required: true
    },
    lastEditedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    lastEditedByName: { type: String, default: '' },
    lastEditedByRole: {
      type: String,
      enum: ['super_admin', 'headmaster', 'school_admin', 'teacher', 'admin', ''],
      default: ''
    },
    lastEditedAt: { type: Date, default: null },
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
      enum: ['draft', 'pending_approval', 'approved', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled'],
      default: 'draft',
      index: true
    },
    channels: [{ type: String, enum: ['telegram', 'whatsapp'] }],
    approvedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    approvedByName: { type: String, default: '' },
    approvedByRole: {
      type: String,
      enum: ['super_admin', 'headmaster', 'school_admin', 'teacher', 'admin', ''],
      default: ''
    },
    approvedAt: { type: Date, default: null },
    sentBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    sentByName: { type: String, default: '' },
    sentByRole: {
      type: String,
      enum: ['super_admin', 'headmaster', 'school_admin', 'teacher', 'admin', ''],
      default: ''
    },
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

BroadcastSchema.index({ schoolId: 1, createdAt: -1 });

export default mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);

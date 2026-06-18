import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import type { AdminRole } from './AdminUser';

export type MessageStatus =
  | 'received'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'partial'
  | 'failed';

export interface IMessage extends Document {
  conversationId?: Types.ObjectId;
  schoolId: string;
  channel: 'telegram' | 'whatsapp' | 'dashboard';
  direction: 'incoming' | 'outgoing';
  senderRole: 'parent' | 'teacher' | 'admin' | AdminRole | 'assistant' | 'system' | 'visitor' | 'unregistered';
  senderUserId?: Types.ObjectId;
  senderName: string;
  body: string;
  messageType: 'text' | 'image' | 'file' | 'audio' | 'system';
  providerMessageId: string;
  aiGenerated: boolean;
  senderType?: 'teacher' | 'parent';
  senderId?: Types.ObjectId;
  recipientType?: 'broadcast' | 'individual' | 'teacher';
  targetClass?: string;
  studentId?: Types.ObjectId;
  teacherId?: Types.ObjectId;
  message?: string;
  deliveredTo: Types.ObjectId[];
  failedTo: Types.ObjectId[];
  status: MessageStatus;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null, index: true },
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    channel: {
      type: String,
      enum: ['telegram', 'whatsapp', 'dashboard'],
      default: 'telegram',
      index: true
    },
    direction: { type: String, enum: ['incoming', 'outgoing'], default: 'outgoing', index: true },
    senderRole: {
      type: String,
      enum: ['parent', 'teacher', 'admin', 'super_admin', 'headmaster', 'school_admin', 'assistant', 'system', 'visitor', 'unregistered'],
      default: 'system',
      index: true
    },
    senderUserId: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null, index: true },
    senderName: { type: String, default: '' },
    body: { type: String, default: '' },
    messageType: {
      type: String,
      enum: ['text', 'image', 'file', 'audio', 'system'],
      default: 'text'
    },
    providerMessageId: { type: String, default: '', index: true },
    aiGenerated: { type: Boolean, default: false, index: true },
    senderType: { type: String, enum: ['teacher', 'parent'], default: null },
    senderId: {
      type: Schema.Types.ObjectId,
      refPath: 'senderType',
      default: null,
      index: true
    },
    recipientType: { type: String, enum: ['broadcast', 'individual', 'teacher'], default: null },
    targetClass: { type: String, default: '', index: true },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      default: null
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null
    },
    message: { type: String, default: '' },
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    failedTo: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
    status: {
      type: String,
      enum: ['received', 'queued', 'sent', 'delivered', 'read', 'partial', 'failed'],
      default: 'sent',
      index: true
    },
    sentAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

MessageSchema.index({ schoolId: 1, conversationId: 1, createdAt: 1 });
MessageSchema.index({ schoolId: 1, channel: 1, createdAt: -1 });

export default mongoose.model<IMessage>('Message', MessageSchema);

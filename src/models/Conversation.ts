import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export type ConversationStatus =
  | 'active'
  | 'open'
  | 'ai_replied'
  | 'needs_human'
  | 'assigned'
  | 'resolved'
  | 'failed';

export interface IConversation extends Document {
  schoolId: string;
  channel: 'telegram' | 'whatsapp' | 'dashboard';
  externalChatId: string;
  participantRole: 'parent' | 'teacher' | 'admin' | 'visitor' | 'unregistered';
  participantName: string;
  participantPhone: string;
  parentId?: Types.ObjectId;
  teacherId?: Types.ObjectId;
  parentPhone: string;
  studentId?: Types.ObjectId;
  classId?: Types.ObjectId;
  assignedTo: string;
  lastMessageAt?: Date;
  type: 'parent_bot' | 'teacher_parent' | 'admin_broadcast';
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    senderName: string;
    timestamp: Date;
  }>;
  status: ConversationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    channel: {
      type: String,
      enum: ['telegram', 'whatsapp', 'dashboard'],
      default: 'dashboard',
      index: true
    },
    externalChatId: { type: String, default: '', index: true },
    participantRole: {
      type: String,
      enum: ['parent', 'teacher', 'admin', 'visitor', 'unregistered'],
      default: 'visitor',
      index: true
    },
    participantName: { type: String, default: '' },
    participantPhone: { type: String, default: '' },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    type: {
      type: String,
      enum: ['parent_bot', 'teacher_parent', 'admin_broadcast'],
      default: 'parent_bot'
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null
    },
    parentPhone: { type: String, default: '' },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      default: null
    },
    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      default: null
    },
    messages: [
      {
        role: String,
        content: String,
        senderName: String,
        timestamp: { type: Date, default: Date.now }
      }
    ],
    status: {
      type: String,
      enum: ['active', 'open', 'ai_replied', 'needs_human', 'assigned', 'resolved', 'failed'],
      default: 'open',
      index: true
    },
    assignedTo: { type: String, default: '' },
    lastMessageAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

ConversationSchema.index({ schoolId: 1, channel: 1, externalChatId: 1 });
ConversationSchema.index({ schoolId: 1, status: 1, lastMessageAt: -1 });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);


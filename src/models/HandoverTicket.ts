import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import type { AdminRole } from './AdminUser';

export interface IHandoverTicket extends Document {
  schoolId: string;
  conversationId: Types.ObjectId;
  reason: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'assigned' | 'resolved' | 'closed';
  assignedTo: string;
  assignedBy?: Types.ObjectId;
  assignedByName: string;
  assignedByRole: AdminRole | '';
  assignedAt: Date | null;
  internalNotes: string;
  notes: Array<{
    text: string;
    createdBy?: Types.ObjectId;
    createdByName: string;
    createdByRole: AdminRole | '';
    createdAt: Date;
  }>;
  aiSuggestedReply: string;
  resolvedAt: Date | null;
  resolvedBy?: Types.ObjectId;
  resolvedByName: string;
  resolvedByRole: AdminRole | '';
  createdAt: Date;
  updatedAt: Date;
}

const HandoverTicketSchema = new Schema<IHandoverTicket>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    reason: { type: String, required: true },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      index: true
    },
    status: {
      type: String,
      enum: ['open', 'assigned', 'resolved', 'closed'],
      default: 'open',
      index: true
    },
    assignedTo: { type: String, default: '' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    assignedByName: { type: String, default: '' },
    assignedByRole: {
      type: String,
      enum: ['super_admin', 'headmaster', 'school_admin', 'teacher', ''],
      default: ''
    },
    assignedAt: { type: Date, default: null },
    internalNotes: { type: String, default: '' },
    notes: [
      {
        text: { type: String, default: '' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
        createdByName: { type: String, default: '' },
        createdByRole: {
          type: String,
          enum: ['super_admin', 'headmaster', 'school_admin', 'teacher', ''],
          default: ''
        },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    aiSuggestedReply: { type: String, default: '' },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    resolvedByName: { type: String, default: '' },
    resolvedByRole: {
      type: String,
      enum: ['super_admin', 'headmaster', 'school_admin', 'teacher', ''],
      default: ''
    }
  },
  { timestamps: true }
);

HandoverTicketSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

export default mongoose.model<IHandoverTicket>('HandoverTicket', HandoverTicketSchema);

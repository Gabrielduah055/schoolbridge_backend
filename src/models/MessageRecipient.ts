import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessageRecipient extends Document {
  broadcastId?: Types.ObjectId;
  messageId?: Types.ObjectId;
  recipientName: string;
  recipientPhone: string;
  recipientRole: 'parent' | 'teacher' | 'admin' | 'visitor';
  studentId?: Types.ObjectId;
  classId?: Types.ObjectId;
  channel: 'telegram' | 'whatsapp';
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
  providerMessageId: string;
  errorMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

const MessageRecipientSchema = new Schema<IMessageRecipient>(
  {
    broadcastId: { type: Schema.Types.ObjectId, ref: 'Broadcast', default: null, index: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null, index: true },
    recipientName: { type: String, default: '' },
    recipientPhone: { type: String, default: '', index: true },
    recipientRole: {
      type: String,
      enum: ['parent', 'teacher', 'admin', 'visitor'],
      default: 'parent',
      index: true
    },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', default: null },
    channel: { type: String, enum: ['telegram', 'whatsapp'], required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped'],
      default: 'pending',
      index: true
    },
    providerMessageId: { type: String, default: '' },
    errorMessage: { type: String, default: '' }
  },
  { timestamps: true }
);

export default mongoose.model<IMessageRecipient>('MessageRecipient', MessageRecipientSchema);


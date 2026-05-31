import mongoose, { Schema, Document, Types } from 'mongoose';

interface IConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ITelegramSession extends Document {
  chatId: string;
  telegramUserId: string;     // msg.from.id — used to detect account changes
  phone: string | null;       // normalized phone, set after contact is shared
  status: 'unverified' | 'parent' | 'teacher' | 'visitor' | 'escalation_pending';
  teacherId?: Types.ObjectId; // set when status === 'teacher'
  firstName: string;
  lastName: string;
  username: string;
  isOwnContact: boolean;      // was contact.user_id === msg.from.id?
  conversationHistory: IConversationMessage[];
  expiresAt: Date;            // MongoDB TTL index — doc is auto-deleted when this passes
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TelegramSessionSchema = new Schema<ITelegramSession>(
  {
    chatId:         { type: String, required: true, unique: true },
    telegramUserId: { type: String, default: '' },
    phone:          { type: String, default: null },
    status: {
      type: String,
      enum: ['unverified', 'parent', 'teacher', 'visitor', 'escalation_pending'],
      default: 'unverified',
      required: true
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null
    },
    firstName:    { type: String, default: '' },
    lastName:     { type: String, default: '' },
    username:     { type: String, default: '' },
    isOwnContact: { type: Boolean, default: false },
    conversationHistory: [
      {
        role:      { type: String, enum: ['user', 'assistant'], required: true },
        content:   { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
      }
    ],
    expiresAt:      { type: Date, required: true },
    lastActivityAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Auto-delete documents after expiresAt passes (TTL index)
TelegramSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Query indexes
TelegramSessionSchema.index({ telegramUserId: 1 });
TelegramSessionSchema.index({ phone: 1 });

export default mongoose.model<ITelegramSession>('TelegramSession', TelegramSessionSchema);

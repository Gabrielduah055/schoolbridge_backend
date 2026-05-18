import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IConversation extends Document {
  type: 'parent_bot' | 'teacher_parent' | 'admin_broadcast';
  teacherId?: Types.ObjectId;
  parentPhone: string;
  studentId?: Types.ObjectId;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    senderName: string;
    timestamp: Date;
  }>;
  status: 'active' | 'resolved';
  createdAt: Date;
}

const ConversationSchema = new Schema({
  type: { 
    type: String, 
    enum: ['parent_bot', 'teacher_parent', 'admin_broadcast'],
    default: 'parent_bot'
  },
  teacherId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    default: null 
  },
  parentPhone: { type: String, required: true },
  studentId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Student', 
    default: null 
  },
  messages: [{
    role: String,
    content: String,
    senderName: String,
    timestamp: { type: Date, default: Date.now }
  }],
  status: { 
    type: String, 
    enum: ['active', 'resolved'], 
    default: 'active' 
  },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IConversation>('Conversation', ConversationSchema);

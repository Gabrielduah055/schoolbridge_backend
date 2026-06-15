import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IAIResponseLog extends Document {
  schoolId: string;
  conversationId: Types.ObjectId;
  messageId?: Types.ObjectId;
  intent: string;
  confidence: number;
  model: any;
  promptSummary: string;
  response: string;
  usedKnowledgeIds: Types.ObjectId[];
  escalationRecommended: boolean;
  createdAt: Date;
}

const AIResponseLogSchema = new Schema(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null, index: true },
    intent: { type: String, default: 'general_question', index: true },
    confidence: { type: Number, default: 0.5 },
    model: { type: String, default: '' },
    promptSummary: { type: String, default: '' },
    response: { type: String, required: true },
    usedKnowledgeIds: [{ type: Schema.Types.ObjectId, ref: 'Knowledge' }],
    escalationRecommended: { type: Boolean, default: false, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model<IAIResponseLog>('AIResponseLog', AIResponseLogSchema);

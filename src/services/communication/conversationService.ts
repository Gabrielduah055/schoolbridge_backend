import Conversation from '../../models/Conversation';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import type { NormalizedInboundMessage, ResolvedSender } from './types';

export const openOrCreateConversation = async (
  inbound: NormalizedInboundMessage,
  sender: ResolvedSender
) => {
  const schoolId = inbound.schoolId || DEFAULT_SCHOOL_ID;
  const now = new Date();

  return Conversation.findOneAndUpdate(
    {
      schoolId,
      channel: inbound.channel,
      externalChatId: inbound.externalChatId
    },
    {
      $setOnInsert: {
        schoolId,
        channel: inbound.channel,
        externalChatId: inbound.externalChatId,
        type: sender.role === 'teacher' ? 'teacher_parent' : 'parent_bot',
        status: 'open'
      },
      $set: {
        participantRole: sender.role,
        participantName: sender.name,
        participantPhone: sender.phone,
        parentPhone: sender.role === 'parent' ? sender.phone : '',
        parentId: sender.parentId ?? null,
        teacherId: sender.teacherId ?? null,
        studentId: sender.studentId ?? null,
        classId: sender.classId ?? null,
        lastMessageAt: now
      }
    },
    { upsert: true, new: true }
  );
};

export const markConversationStatus = async (
  conversationId: string,
  status: 'ai_replied' | 'needs_human' | 'assigned' | 'resolved' | 'failed'
) => {
  await Conversation.updateOne(
    { _id: conversationId },
    { $set: { status, lastMessageAt: new Date() } }
  );
};


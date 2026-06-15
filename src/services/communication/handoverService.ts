import { Types } from 'mongoose';
import HandoverTicket from '../../models/HandoverTicket';
import Conversation from '../../models/Conversation';
import { DEFAULT_SCHOOL_ID } from '../../config/school';

interface CreateTicketArgs {
  schoolId?: string;
  conversationId: Types.ObjectId;
  reason: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  internalNotes?: string;
  aiSuggestedReply?: string;
}

export const createTicket = async ({
  schoolId = DEFAULT_SCHOOL_ID,
  conversationId,
  reason,
  priority = 'normal',
  internalNotes = '',
  aiSuggestedReply = ''
}: CreateTicketArgs) => {
  const existing = await HandoverTicket.findOne({
    schoolId,
    conversationId,
    status: { $in: ['open', 'assigned'] }
  });

  if (existing) return existing;

  const ticket = await HandoverTicket.create({
    schoolId,
    conversationId,
    reason,
    priority,
    status: 'open',
    internalNotes,
    aiSuggestedReply
  });

  await Conversation.updateOne(
    { _id: conversationId },
    { $set: { status: 'needs_human', lastMessageAt: new Date() } }
  );

  return ticket;
};


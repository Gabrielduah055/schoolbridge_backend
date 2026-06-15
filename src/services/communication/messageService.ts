import { Types } from 'mongoose';
import Message from '../../models/Message';
import Conversation from '../../models/Conversation';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import type { NormalizedInboundMessage, ResolvedSender } from './types';

interface RecordIncomingArgs {
  inbound: NormalizedInboundMessage;
  conversationId: Types.ObjectId;
  sender: ResolvedSender;
}

interface RecordOutgoingArgs {
  schoolId?: string;
  channel: 'telegram' | 'whatsapp' | 'dashboard';
  conversationId: Types.ObjectId;
  senderName?: string;
  senderRole?: 'admin' | 'assistant' | 'system' | 'teacher';
  body: string;
  providerMessageId?: string;
  aiGenerated?: boolean;
  status?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
}

const touchConversation = async (conversationId: Types.ObjectId) => {
  await Conversation.updateOne(
    { _id: conversationId },
    { $set: { lastMessageAt: new Date() } }
  );
};

export const recordIncomingMessage = async ({
  inbound,
  conversationId,
  sender
}: RecordIncomingArgs) => {
  const message = await Message.create({
    conversationId,
    schoolId: inbound.schoolId || DEFAULT_SCHOOL_ID,
    channel: inbound.channel,
    direction: 'incoming',
    senderRole: sender.role,
    senderName: sender.name,
    body: inbound.text,
    messageType: 'text',
    providerMessageId: inbound.providerMessageId || '',
    aiGenerated: false,
    status: 'received',
    sentAt: new Date()
  });

  await touchConversation(conversationId);
  return message;
};

export const recordOutgoingMessage = async ({
  schoolId,
  channel,
  conversationId,
  senderName = 'SchoolBridge Bot',
  senderRole,
  body,
  providerMessageId = '',
  aiGenerated = false,
  status = 'queued'
}: RecordOutgoingArgs) => {
  const message = await Message.create({
    conversationId,
    schoolId: schoolId || DEFAULT_SCHOOL_ID,
    channel,
    direction: 'outgoing',
    senderRole: senderRole || (aiGenerated ? 'assistant' : 'system'),
    senderName,
    body,
    messageType: 'text',
    providerMessageId,
    aiGenerated,
    status,
    sentAt: new Date()
  });

  await touchConversation(conversationId);
  return message;
};

import { Types } from 'mongoose';
import { chatWithSchoolAgent, resolveOpenRouterModel } from '../../agents/schoolAgent';
import AIResponseLog from '../../models/AIResponseLog';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { resolveSender } from './identityService';
import { openOrCreateConversation, markConversationStatus } from './conversationService';
import { recordIncomingMessage, recordOutgoingMessage } from './messageService';
import { logDelivery } from './deliveryService';
import { createTicket } from './handoverService';
import type {
  NormalizedInboundMessage,
  OutgoingCommunicationResponse,
  ParticipantRole
} from './types';

const HUMAN_REQUEST_PATTERNS = [
  /\bhuman\b/i,
  /\breal person\b/i,
  /\badmin\b/i,
  /\bheadmaster\b/i,
  /\bprincipal\b/i,
  /\bteacher\b/i,
  /\bspeak to\b/i,
  /\btalk to\b/i
];

const SENSITIVE_PATTERNS = [
  /\bcomplaint\b/i,
  /\babuse\b/i,
  /\bbully/i,
  /\bharass/i,
  /\bemergency\b/i,
  /\bsick\b/i,
  /\binjured\b/i,
  /\bsensitive\b/i,
  /\bprivate matter\b/i
];

const detectIntent = (text: string): string => {
  if (HUMAN_REQUEST_PATTERNS.some(pattern => pattern.test(text))) return 'human_request';
  if (SENSITIVE_PATTERNS.some(pattern => pattern.test(text))) return 'sensitive_issue';
  return 'general_question';
};

const shouldEscalate = (text: string, aiResponse: string) => {
  if (HUMAN_REQUEST_PATTERNS.some(pattern => pattern.test(text))) {
    return { escalate: true, reason: 'User requested a human response', priority: 'normal' as const };
  }

  if (SENSITIVE_PATTERNS.some(pattern => pattern.test(text))) {
    return { escalate: true, reason: 'Message appears sensitive or urgent', priority: 'high' as const };
  }

  if (/I don't have that information/i.test(aiResponse)) {
    return { escalate: true, reason: 'AI could not answer from available information', priority: 'normal' as const };
  }

  return { escalate: false, reason: '', priority: 'normal' as const };
};

const buildHistory = (text: string) => [{ role: 'user' as const, content: text }];

export const handleIncomingMessage = async (
  inbound: NormalizedInboundMessage,
  knownRole?: ParticipantRole
): Promise<OutgoingCommunicationResponse> => {
  const schoolId = inbound.schoolId || DEFAULT_SCHOOL_ID;
  const sender = await resolveSender({ ...inbound, schoolId }, knownRole);
  const conversation = await openOrCreateConversation({ ...inbound, schoolId }, sender);

  const incomingMessage = await recordIncomingMessage({
    inbound: { ...inbound, schoolId },
    conversationId: conversation._id as Types.ObjectId,
    sender
  });

  await logDelivery({
    messageId: incomingMessage._id as Types.ObjectId,
    schoolId,
    channel: inbound.channel === 'dashboard' ? 'telegram' : inbound.channel,
    provider: inbound.provider,
    providerMessageId: inbound.providerMessageId,
    eventType: 'inbound_received',
    status: 'received',
    rawPayload: inbound.rawPayload ?? null
  });

  const model = resolveOpenRouterModel();
  const aiResponse = await chatWithSchoolAgent(
    buildHistory(inbound.text),
    sender.role === 'visitor' ? 'unregistered' : sender.role,
    sender.phone,
    sender.name
  );

  const intent = detectIntent(inbound.text);
  const escalation = shouldEscalate(inbound.text, aiResponse);

  await AIResponseLog.create({
    schoolId,
    conversationId: conversation._id,
    messageId: incomingMessage._id,
    intent,
    confidence: escalation.escalate ? 0.9 : 0.7,
    model,
    promptSummary: inbound.text.slice(0, 300),
    response: aiResponse,
    usedKnowledgeIds: [],
    escalationRecommended: escalation.escalate
  });

  let responseBody = aiResponse;
  let handoverTicketId: Types.ObjectId | undefined;

  if (escalation.escalate) {
    const ticket = await createTicket({
      schoolId,
      conversationId: conversation._id as Types.ObjectId,
      reason: escalation.reason,
      priority: escalation.priority,
      aiSuggestedReply: aiResponse
    });
    handoverTicketId = ticket._id as Types.ObjectId;
    responseBody = 'Thanks for sharing this. I have forwarded it to the school team for human attention, and someone will follow up.';
  }

  const outgoingMessage = await recordOutgoingMessage({
    schoolId,
    channel: inbound.channel,
    conversationId: conversation._id as Types.ObjectId,
    body: responseBody,
    aiGenerated: !escalation.escalate,
    status: 'queued'
  });

  await markConversationStatus(
    conversation._id.toString(),
    escalation.escalate ? 'needs_human' : 'ai_replied'
  );

  return {
    conversationId: conversation._id as Types.ObjectId,
    incomingMessageId: incomingMessage._id as Types.ObjectId,
    outgoingMessageId: outgoingMessage._id as Types.ObjectId,
    handoverTicketId,
    body: responseBody,
    channel: inbound.channel,
    provider: inbound.provider
  };
};


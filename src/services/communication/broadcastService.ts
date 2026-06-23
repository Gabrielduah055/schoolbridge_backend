import { Types } from 'mongoose';
import bot from '../../bot/telegram';
import Broadcast from '../../models/Broadcast';
import Message from '../../models/Message';
import MessageRecipient from '../../models/MessageRecipient';
import Class from '../../models/Class';
import Student from '../../models/Students';
import Teacher from '../../models/Teacher';
import TelegramIdentity from '../../models/TelegramIdentity';
import WhatsAppIdentity from '../../models/WhatsAppIdentity';
import { chatWithSchoolAgent } from '../../agents/schoolAgent';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { WASENDER_PROVIDER } from '../../config/wasender';
import { normalizePhoneNumber } from '../../utils/phone';
import { sendWhatsAppText } from '../../channels/whatsapp/whatsappAdapter';
import { logDelivery } from './deliveryService';
import { findParentTelegramIdentityByPhone } from '../telegramIdentityReconciliationService';
import type { AdminRole } from '../../models/AdminUser';

type BroadcastAudience = 'whole_school' | 'class' | 'individual' | 'individual_parent' | 'teachers' | 'parents';
type BroadcastChannel = 'telegram' | 'whatsapp';

interface CreateDraftArgs {
  schoolId?: string;
  createdBy?: Types.ObjectId;
  createdByName?: string;
  createdByRole: AdminRole | 'teacher' | 'admin';
  audienceType: BroadcastAudience;
  classId?: Types.ObjectId;
  recipientStudentId?: Types.ObjectId;
  recipientStudentName?: string;
  targetClass?: string;
  recipientPhone?: string;
  title?: string;
  originalText: string;
  draftedText?: string;
  attachments?: BroadcastAttachment[];
  channels?: BroadcastChannel[];
}

interface BroadcastAttachment {
  originalName: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
}

interface RecipientCandidate {
  name: string;
  phone: string;
  role: 'parent' | 'teacher';
  studentId?: Types.ObjectId;
  classId?: Types.ObjectId;
  targetClass?: string;
}

interface BroadcastActor {
  id: string;
  name: string;
  role: AdminRole;
}

export interface RecipientPreviewItem {
  name: string;
  role: 'parent' | 'teacher';
  phone: string;
  studentName: string;
  className: string;
  telegramLinked: boolean;
  telegramChatId: string | null;
  whatsappLinked: boolean;
  whatsappChatId: string | null;
  canReceiveNow: boolean;
  reasonIfNotReachable: string | null;
}

export interface RecipientPreview {
  audienceType: BroadcastAudience;
  totalContacts: number;
  telegramReachable: number;
  telegramMissing: number;
  whatsappReachable: number;
  whatsappMissing: number;
  reachableNow: number;
  unreachableNow: number;
  recipients: RecipientPreviewItem[];
}

export const cleanBroadcastText = (value: string) => {
  const text = value
    .replace(/^here(?:'s| is)\s+(?:a\s+)?(?:polished|refined|revised)\s+version\s+of\s+your\s+broadcast:?\s*/i, '')
    .replace(/^sure,?\s+i\s+can\s+help.*?\n+/i, '')
    .replace(/would you like me to .*$/ims, '')
    .replace(/^\s*-{3,}\s*/m, '')
    .trim();

  return text || value.trim();
};

export const createDraft = async ({
  schoolId = DEFAULT_SCHOOL_ID,
  createdBy,
  createdByName = '',
  createdByRole,
  audienceType,
  classId,
  recipientStudentId,
  recipientStudentName = '',
  targetClass = '',
  recipientPhone = '',
  title = '',
  originalText,
  draftedText = '',
  attachments = [],
  channels = ['telegram']
}: CreateDraftArgs) => {
  let finalDraft = draftedText || originalText;

  if (!draftedText) {
    try {
      finalDraft = await chatWithSchoolAgent(
        [{
          role: 'user',
          content: `Polish this school broadcast. Return only the final announcement text that parents should receive. Do not include assistant commentary, explanations, labels, questions, markdown fences, or phrases like "Here's a polished version" or "Would you like me to adjust".\n\n${originalText}`
        }],
        createdByRole,
        '',
        createdByRole === 'teacher' ? 'Teacher' : 'Admin',
        'fast'
      );
    } catch {
      finalDraft = originalText;
    }
  }

  finalDraft = cleanBroadcastText(finalDraft);

  return Broadcast.create({
    schoolId,
    createdBy,
    createdByName,
    createdByRole,
    audienceType,
    classId,
    recipientStudentId,
    recipientStudentName,
    targetClass,
    recipientPhone,
    title,
    originalText: cleanBroadcastText(originalText),
    draftedText: finalDraft,
    attachments,
    approvalStatus: 'pending_approval',
    status: 'pending_approval',
    channels: channels.filter((channel): channel is BroadcastChannel => ['telegram', 'whatsapp'].includes(channel))
  });
};

const uniqueByPhone = (recipients: RecipientCandidate[]) => {
  const byPhone = new Map<string, RecipientCandidate>();
  for (const recipient of recipients) {
    const normalized = normalizePhoneNumber(recipient.phone);
    if (normalized && !byPhone.has(normalized)) {
      byPhone.set(normalized, { ...recipient, phone: normalized });
    }
  }
  return Array.from(byPhone.values());
};

const parentRecipientsFromStudents = async (filter: Record<string, unknown>) => {
  const students = await Student.find({ status: 'active', ...filter }).lean();
  return uniqueByPhone(students.flatMap((student: any) =>
    [student.parentPhone, student.parentPhone2]
      .filter(Boolean)
      .map((phone) => ({
        name: student.parentName || 'Parent',
        phone,
        role: 'parent' as const,
        studentId: student._id,
        studentName: student.name || '',
        targetClass: student.class
      }))
  ));
};

const resolveClassName = async (classRef: string) => {
  if (!classRef) return '';
  if (!Types.ObjectId.isValid(classRef)) return classRef;
  const classRecord = await Class.findById(classRef).lean();
  return classRecord?.className || classRecord?.name || classRef;
};

const teacherRecipients = async () => {
  const teachers = await Teacher.find({ active: true }).lean();
  return uniqueByPhone(teachers.map((teacher: any) => ({
    name: teacher.fullName,
    phone: teacher.phone,
    role: 'teacher' as const
  })));
};

const findTelegramIdentityForRecipient = async (recipient: RecipientCandidate) => {
  if (recipient.role === 'parent') {
    return findParentTelegramIdentityByPhone(recipient.phone);
  }

  return TelegramIdentity.findOne({
    phone: normalizePhoneNumber(recipient.phone),
    status: recipient.role
  });
};

const findWhatsAppIdentityForRecipient = async (recipient: RecipientCandidate) =>
  WhatsAppIdentity.findOne({
    normalizedPhone: normalizePhoneNumber(recipient.phone),
    status: recipient.role
  });

const createRecipientRow = async (
  broadcast: any,
  recipient: RecipientCandidate,
  channel: BroadcastChannel,
  hasIdentity: boolean,
  missingReason: string
) => {
  const recipientRow = new MessageRecipient({
    broadcastId: broadcast._id,
    recipientName: recipient.name,
    recipientPhone: normalizePhoneNumber(recipient.phone),
    recipientRole: recipient.role,
    ...(recipient.studentId ? { studentId: recipient.studentId } : {}),
    ...(recipient.classId ? { classId: recipient.classId } : {}),
    channel,
    status: hasIdentity ? 'pending' : 'skipped',
    errorMessage: hasIdentity ? '' : missingReason
  });
  await recipientRow.save();
  return recipientRow;
};

const createBroadcastMessage = async (
  broadcast: any,
  recipient: RecipientCandidate,
  channel: BroadcastChannel,
  body: string
) => {
  const message = new Message({
    schoolId: broadcast.schoolId || DEFAULT_SCHOOL_ID,
    channel,
    direction: 'outgoing',
    senderRole: broadcast.createdByRole,
    senderName: broadcast.createdByRole === 'teacher' ? 'Teacher' : 'Admin',
    body,
    messageType: 'text',
    aiGenerated: false,
    recipientType: 'broadcast',
    targetClass: recipient.targetClass || broadcast.targetClass || '',
    status: 'queued',
    sentAt: new Date()
  });
  await message.save();
  return message;
};

export const resolveRecipients = async (broadcast: {
  audienceType: BroadcastAudience;
  classId?: Types.ObjectId | string | null;
  targetClass?: string;
  recipientStudentId?: Types.ObjectId | string | null;
  recipientPhone?: string;
}): Promise<RecipientCandidate[]> => {
  if (broadcast.audienceType === 'class') {
    const targetClass = await resolveClassName(broadcast.targetClass || broadcast.classId?.toString() || '');
    if (!targetClass) return [];
    return parentRecipientsFromStudents({ class: targetClass });
  }

  if (broadcast.audienceType === 'parents') {
    return parentRecipientsFromStudents({});
  }

  if (broadcast.audienceType === 'whole_school') {
    return uniqueByPhone([
      ...await parentRecipientsFromStudents({}),
      ...await teacherRecipients()
    ]);
  }

  if (broadcast.audienceType === 'individual' || broadcast.audienceType === 'individual_parent') {
    if (broadcast.recipientStudentId) {
      const student = await Student.findOne({
        _id: broadcast.recipientStudentId,
        status: 'active'
      }).lean();

      if (!student) return [];

      return parentRecipientsFromStudents({ _id: student._id });
    }

    if (!broadcast.recipientPhone) return [];
    return [{ name: 'Parent', phone: broadcast.recipientPhone, role: 'parent' }];
  }

  if (broadcast.audienceType === 'teachers') {
    return teacherRecipients();
  }

  return [];
};

export const sendApprovedBroadcast = async (broadcastId: string, actor?: BroadcastActor) => {
  const broadcast = await Broadcast.findById(broadcastId);

  if (!broadcast) {
    throw new Error('Broadcast not found');
  }

  if (broadcast.approvalStatus !== 'approved') {
    throw new Error('Broadcast must be approved before sending');
  }

  const channels = (broadcast.channels || []).filter((channel): channel is BroadcastChannel =>
    ['telegram', 'whatsapp'].includes(channel)
  );

  if (channels.length === 0) {
    throw new Error('At least one supported broadcast channel is required');
  }

  broadcast.status = 'sending';
  await broadcast.save();

  const body = cleanBroadcastText(broadcast.draftedText || broadcast.originalText);
  // TODO: Move broadcast attachments to durable cloud storage before production pilot.
  const attachments = (broadcast.attachments || []) as BroadcastAttachment[];
  const recipients = await resolveRecipients(broadcast);
  let sentCount = 0;
  let failedCount = 0;
  let pendingCount = 0;

  for (const recipient of recipients) {
    for (const channel of channels) {
      const identity: any = channel === 'telegram'
        ? await findTelegramIdentityForRecipient(recipient)
        : await findWhatsAppIdentityForRecipient(recipient);
      const missingReason = channel === 'telegram'
        ? 'No Telegram identity for recipient'
        : 'No WhatsApp identity for recipient';
      const recipientRow = await createRecipientRow(
        broadcast,
        recipient,
        channel,
        Boolean(identity),
        missingReason
      );

      if (!identity) {
        pendingCount++;
        continue;
      }

      const message = await createBroadcastMessage(broadcast, recipient, channel, body);
      recipientRow.messageId = message._id as Types.ObjectId;

      try {
        let providerMessageId = '';
        let rawPayload: Record<string, unknown> | null = null;
        let provider = '';

        if (channel === 'telegram') {
          const sent = await bot.sendMessage(identity.chatId, body);

          for (const attachment of attachments) {
            await bot.sendDocument(
              identity.chatId,
              attachment.filePath,
              {},
              {
                filename: attachment.originalName || attachment.fileName,
                contentType: attachment.mimeType || undefined
              }
            );
          }

          provider = 'telegram_bot';
          providerMessageId = sent.message_id.toString();
          rawPayload = sent as unknown as Record<string, unknown>;
        } else {
          const sent = await sendWhatsAppText({
            to: recipient.phone,
            text: body
          });

          provider = WASENDER_PROVIDER;
          providerMessageId = sent.providerMessageId;
          rawPayload = sent.raw;

          await WhatsAppIdentity.updateOne(
            { _id: identity._id },
            { $set: { lastOutboundAt: new Date() } }
          );
        }

        message.status = 'sent';
        message.providerMessageId = providerMessageId;
        await message.save();

        recipientRow.status = 'sent';
        recipientRow.providerMessageId = providerMessageId;
        await recipientRow.save();

        await logDelivery({
          messageId: message._id as Types.ObjectId,
          broadcastId: broadcast._id as Types.ObjectId,
          recipientId: recipientRow._id as Types.ObjectId,
          schoolId: broadcast.schoolId || DEFAULT_SCHOOL_ID,
          channel,
          provider,
          providerMessageId,
          eventType: 'broadcast_sent',
          status: 'sent',
          rawPayload
        });

        sentCount++;
      } catch (error: any) {
        message.status = 'failed';
        await message.save();

        recipientRow.status = 'failed';
        recipientRow.errorMessage = error?.message || `${channel === 'telegram' ? 'Telegram' : 'WhatsApp'} send failed`;
        await recipientRow.save();

        await logDelivery({
          messageId: message._id as Types.ObjectId,
          broadcastId: broadcast._id as Types.ObjectId,
          recipientId: recipientRow._id as Types.ObjectId,
          schoolId: broadcast.schoolId || DEFAULT_SCHOOL_ID,
          channel,
          provider: channel === 'telegram' ? 'telegram_bot' : WASENDER_PROVIDER,
          eventType: 'broadcast_failed',
          status: 'failed',
          errorMessage: recipientRow.errorMessage
        });

        failedCount++;
      }
    }
  }

  const totalRecipients = recipients.length;
  const totalDeliveries = recipients.length * channels.length;
  broadcast.sentAt = new Date();
  if (actor && Types.ObjectId.isValid(actor.id)) {
    broadcast.sentBy = new Types.ObjectId(actor.id);
    broadcast.sentByName = actor.name;
    broadcast.sentByRole = actor.role;
  }
  const unsuccessfulCount = failedCount + pendingCount;
  broadcast.status =
    totalDeliveries === 0 || sentCount === 0
      ? 'failed'
      : unsuccessfulCount > 0
        ? 'partially_failed'
        : 'sent';
  await broadcast.save();

  return {
    broadcast,
    deliverySummary: {
      totalRecipients,
      totalDeliveries,
      sentCount,
      failedCount,
      pendingCount
    }
  };
};

export const previewRecipients = async (
  input: {
    audienceType: BroadcastAudience;
    targetClass?: string;
    classId?: string;
    recipientStudentId?: string;
    recipientPhone?: string;
  }
): Promise<RecipientPreview> => {
  const recipients = await resolveRecipients({
    audienceType: input.audienceType,
    targetClass: input.targetClass || input.classId || '',
    recipientStudentId: input.recipientStudentId,
    recipientPhone: input.recipientPhone
  });

  const previewItems: RecipientPreviewItem[] = [];

  for (const recipient of recipients) {
    const telegramIdentity = await findTelegramIdentityForRecipient(recipient);
    const whatsappIdentity = await findWhatsAppIdentityForRecipient(recipient);

    previewItems.push({
      name: recipient.name,
      role: recipient.role,
      phone: normalizePhoneNumber(recipient.phone),
      studentName: (recipient as any).studentName || '',
      className: recipient.targetClass || '',
      telegramLinked: Boolean(telegramIdentity?.chatId),
      telegramChatId: telegramIdentity?.chatId || null,
      whatsappLinked: Boolean(whatsappIdentity?.externalChatId),
      whatsappChatId: whatsappIdentity?.externalChatId || null,
      canReceiveNow: Boolean(telegramIdentity?.chatId || whatsappIdentity?.externalChatId),
      reasonIfNotReachable: telegramIdentity?.chatId || whatsappIdentity?.externalChatId
        ? null
        : 'Not connected to Telegram or WhatsApp'
    });
  }

  const telegramReachable = previewItems.filter((recipient) => recipient.telegramLinked).length;
  const telegramMissing = previewItems.length - telegramReachable;
  const whatsappReachable = previewItems.filter((recipient) => recipient.whatsappLinked).length;
  const whatsappMissing = previewItems.length - whatsappReachable;
  const reachableNow = previewItems.filter((recipient) => recipient.canReceiveNow).length;

  return {
    audienceType: input.audienceType,
    totalContacts: previewItems.length,
    telegramReachable,
    telegramMissing,
    whatsappReachable,
    whatsappMissing,
    reachableNow,
    unreachableNow: previewItems.length - reachableNow,
    recipients: previewItems
  };
};

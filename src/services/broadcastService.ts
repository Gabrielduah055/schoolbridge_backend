import TelegramBot from 'node-telegram-bot-api';
import { Types } from 'mongoose';
import Student from '../models/Students';
import TelegramIdentity from '../models/TelegramIdentity';
import Message from '../models/Message';
import Broadcast from '../models/Broadcast';
import MessageRecipient from '../models/MessageRecipient';
import { getPhoneLookupCandidates } from '../utils/phone';
import { chatWithSchoolAgent } from '../agents/schoolAgent';
import { type TeacherContext } from './teacherAuthService';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { logDelivery } from './communication/deliveryService';
import logger from '../utils/logger';

// ─── Time guard ───────────────────────────────────────────────────────────────

const BROADCAST_START_HOUR = 18; // 6 PM Ghana time (UTC+0 — adjust if needed)

/**
 * Returns true if the current UTC hour is at or after the broadcast window start.
 * Ghana is UTC+0 (GMT) year-round, so no offset adjustment is needed.
 */
export const isBroadcastWindowOpen = (): boolean => {
  const nowHour = new Date().getUTCHours();
  return nowHour >= BROADCAST_START_HOUR;
};

export const broadcastWindowOpensAt = (): string => {
  const date = new Date();
  date.setUTCHours(BROADCAST_START_HOUR, 0, 0, 0);
  return `6:00 PM`;
};

// ─── Unified intent detection ─────────────────────────────────────────────────

const INTENT_SYSTEM_INJECT = `
INTENT CLASSIFICATION RULE (highest priority — follow exactly):
Analyse the teacher's message and classify it into one of these intents.

1. BROADCAST — send message NOW to ALL parents in class.
   {"intent":"broadcast","message":"<standalone message>"}

2. STUDENT_MESSAGE — send message NOW to ONE specific student's parent.
   {"intent":"student_message","studentName":"<name>","message":"<standalone message>"}

3. SCHEDULED — teacher wants to send a message at a specific future time.
   Examples: "Send at 6pm", "Remind all parents at 5:30", "Tell Kofi's parent at 7pm"
   {"intent":"scheduled","targetType":"broadcast" or "individual","studentName":"<only if individual>","message":"<standalone message>","scheduledTime":"<HH:MM in 24hr format>"}
   If no time is mentioned but it is clearly a future/scheduled intent, set scheduledTime to "".

4. VIEW_SCHEDULED — teacher wants to see their pending scheduled messages.
   Examples: "What messages have I scheduled?", "Show my scheduled messages"
   {"intent":"view_scheduled"}

5. CANCEL_SCHEDULED — teacher wants to cancel a scheduled message.
   Examples: "Cancel my scheduled message", "Cancel the 6pm reminder", "Cancel 1"
   {"intent":"cancel_scheduled","ref":"<time like 18:00 or list index like 1 if mentioned, else empty string>"}

6. NORMAL — any other conversation. Respond normally as SchoolBridge assistant.

RULES:
- Extracted messages must be complete standalone sentences fit for a parent to read.
- Do NOT include teacher instructions or meta-language in extracted messages.
- If unsure between broadcast and student_message, return:
  {"intent":"clarify","question":"Did you want to message all parents, or just one specific parent?"}
- If scheduled but no clear time given, return:
  {"intent":"scheduled","targetType":"broadcast","message":"<extracted>","scheduledTime":""}
`;

export type MessageIntent =
  | { intent: 'broadcast'; message: string }
  | { intent: 'student_message'; studentName: string; message: string }
  | { intent: 'scheduled'; targetType: 'broadcast' | 'individual'; studentName?: string; message: string; scheduledTime: string }
  | { intent: 'view_scheduled' }
  | { intent: 'cancel_scheduled'; ref: string }
  | { intent: 'clarify'; question: string }
  | { intent: 'normal' };

/**
 * Single AI call that classifies the teacher's message into one of four intents.
 * Callers use the returned intent to decide which pipeline to invoke.
 */
export const detectMessageIntent = async (
  messageText: string,
  ctx: TeacherContext
): Promise<MessageIntent> => {
  const injectedMessage = `${INTENT_SYSTEM_INJECT}\n\nTeacher says: ${messageText}`;

  let raw: string;
  try {
    raw = await chatWithSchoolAgent(
      [{ role: 'user', content: injectedMessage }],
      'teacher',
      '',
      ctx.teacher.fullName
    );
  } catch {
    return { intent: 'normal' }; // AI failure — fall through to normal conversation
  }

  // Extract first JSON object from the response
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return { intent: 'normal' };

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;

    if (parsed.intent === 'broadcast' && parsed.message?.trim()) {
      return { intent: 'broadcast', message: parsed.message.trim() };
    }

    if (parsed.intent === 'student_message' && parsed.studentName?.trim() && parsed.message?.trim()) {
      return {
        intent: 'student_message',
        studentName: parsed.studentName.trim(),
        message: parsed.message.trim()
      };
    }

    if (parsed.intent === 'scheduled' && parsed.message?.trim()) {
      return {
        intent: 'scheduled',
        targetType: parsed.targetType === 'individual' ? 'individual' : 'broadcast',
        studentName: parsed.studentName?.trim() || undefined,
        message: parsed.message.trim(),
        scheduledTime: parsed.scheduledTime?.trim() ?? ''
      };
    }

    if (parsed.intent === 'view_scheduled') {
      return { intent: 'view_scheduled' };
    }

    if (parsed.intent === 'cancel_scheduled') {
      return { intent: 'cancel_scheduled', ref: parsed.ref?.trim() ?? '' };
    }

    if (parsed.intent === 'clarify' && parsed.question?.trim()) {
      return { intent: 'clarify', question: parsed.question.trim() };
    }
  } catch {
    // Malformed JSON — treat as normal
  }

  return { intent: 'normal' };
};

// Keep the old export name as a thin wrapper so nothing else breaks
export const detectBroadcastIntent = async (
  messageText: string,
  ctx: TeacherContext
): Promise<{ intent: 'broadcast'; message: string } | null> => {
  const result = await detectMessageIntent(messageText, ctx);
  return result.intent === 'broadcast' ? result : null;
};

// ─── Parent lookup ────────────────────────────────────────────────────────────

interface ParentTarget {
  studentId: Types.ObjectId;
  studentName: string;
  chatId: string;            // parent's Telegram chatId
}

interface MissedParent {
  studentId: Types.ObjectId;
  studentName: string;
  reason: 'not_on_telegram';
}

/**
 * Finds all students in the class, then resolves each parent's Telegram chatId.
 * Students whose parents have not verified on Telegram are tracked in `missed`.
 */
export const resolveClassParents = async (
  className: string
): Promise<{ targets: ParentTarget[]; missed: MissedParent[] }> => {
  const students = await Student.find({ class: className, status: 'active' });

  const targets: ParentTarget[] = [];
  const missed: MissedParent[] = [];

  for (const student of students) {
    const phonesToTry = [student.parentPhone, student.parentPhone2].filter(Boolean);

    let found = false;

    for (const phone of phonesToTry) {
      const candidates = getPhoneLookupCandidates(phone);

      const identity = await TelegramIdentity.findOne({
        phone: { $in: candidates },
        status: 'parent'
      }).select('chatId');

      if (identity?.chatId) {
        targets.push({
          studentId: student._id as Types.ObjectId,
          studentName: student.name,
          chatId: identity.chatId
        });
        found = true;
        break; // one chatId per student is enough
      }
    }

    if (!found) {
      missed.push({
        studentId: student._id as Types.ObjectId,
        studentName: student.name,
        reason: 'not_on_telegram'
      });
    }
  }

  return { targets, missed };
};

// ─── Bulk sender ──────────────────────────────────────────────────────────────

interface SendResult {
  delivered: Types.ObjectId[];
  failed: Types.ObjectId[];
}

/**
 * Sends the formatted message to each resolved parent chatId.
 * Per-send errors are caught and logged — one failure never stops the broadcast.
 */
export const sendToParents = async (
  bot: TelegramBot,
  targets: ParentTarget[],
  className: string,
  extractedMessage: string
): Promise<SendResult> => {
  const formatted =
    `📢 *Message from ${className} Class Teacher*\n\n` +
    `${extractedMessage}\n\n` +
    `— _SchoolBridge_`;

  const delivered: Types.ObjectId[] = [];
  const failed: Types.ObjectId[] = [];

  for (const target of targets) {
    try {
      await bot.sendMessage(target.chatId, formatted, { parse_mode: 'Markdown' });
      delivered.push(target.studentId);
      logger.info(
        { className, studentName: target.studentName },
        'Broadcast delivered to parent'
      );
    } catch (err) {
      failed.push(target.studentId);
      logger.error(
        { className, studentName: target.studentName, err },
        'Broadcast failed for parent (bot blocked or invalid chatId)'
      );
    }
  }

  return { delivered, failed };
};

// ─── Broadcast log ────────────────────────────────────────────────────────────

/**
 * Persists a single Message document summarising the entire broadcast.
 */
export const logBroadcast = async (
  ctx: TeacherContext,
  extractedMessage: string,
  delivered: Types.ObjectId[],
  failed: Types.ObjectId[]
): Promise<void> => {
  const total = delivered.length + failed.length;
  const status =
    total === 0
      ? 'failed'
      : failed.length === 0
        ? 'sent'
        : 'partial';

  const message = await Message.create({
    schoolId: DEFAULT_SCHOOL_ID,
    channel: 'telegram',
    direction: 'outgoing',
    senderRole: 'teacher',
    senderName: ctx.teacher.fullName,
    body: extractedMessage,
    messageType: 'text',
    aiGenerated: false,
    senderType: 'teacher',
    senderId: ctx.teacher._id,
    recipientType: 'broadcast',
    targetClass: ctx.className,
    message: extractedMessage,
    deliveredTo: delivered,
    failedTo: failed,
    status,
    sentAt: new Date()
  });

  const broadcast = await Broadcast.create({
    schoolId: DEFAULT_SCHOOL_ID,
    createdBy: ctx.teacher._id,
    createdByRole: 'teacher',
    audienceType: 'class',
    classId: ctx.assignedClass._id,
    title: `${ctx.className} broadcast`,
    originalText: extractedMessage,
    draftedText: extractedMessage,
    approvalStatus: 'approved',
    status,
    channels: ['telegram'],
    sentAt: new Date()
  });

  const students = await Student.find({
    _id: { $in: [...delivered, ...failed] }
  }).select('name parentPhone parentPhone2');

  const studentById = new Map(students.map(student => [student._id.toString(), student]));
  const recipientRows = [
    ...delivered.map(studentId => ({ studentId, status: 'sent' as const })),
    ...failed.map(studentId => ({ studentId, status: 'failed' as const }))
  ].map(({ studentId, status: deliveryStatus }) => {
    const student = studentById.get(studentId.toString());
    return {
      broadcastId: broadcast._id,
      messageId: message._id,
      recipientName: student?.name || '',
      recipientPhone: student?.parentPhone || student?.parentPhone2 || '',
      recipientRole: 'parent',
      studentId,
      classId: ctx.assignedClass._id,
      channel: 'telegram',
      status: deliveryStatus,
      errorMessage: deliveryStatus === 'failed' ? 'Parent was not reachable on Telegram' : ''
    };
  });

  if (recipientRows.length > 0) {
    await MessageRecipient.insertMany(recipientRows);
  }

  await logDelivery({
    messageId: message._id as Types.ObjectId,
    channel: 'telegram',
    provider: 'telegram',
    eventType: 'broadcast_summary',
    status: status === 'sent' || status === 'failed' ? status : 'unknown',
    rawPayload: {
      broadcastId: broadcast._id.toString(),
      delivered: delivered.length,
      failed: failed.length
    }
  });
};

// ─── Delivery summary builder ─────────────────────────────────────────────────

/**
 * Builds the summary message sent back to the teacher after broadcast completes.
 */
export const buildDeliverySummary = (
  className: string,
  extractedMessage: string,
  delivered: Types.ObjectId[],
  missed: MissedParent[],
  sendFailed: Types.ObjectId[]
): string => {
  const reached = delivered.length;
  const total = reached + missed.length + sendFailed.length;
  const notReached = missed.length + sendFailed.length;

  const preview =
    extractedMessage.length > 80
      ? `${extractedMessage.slice(0, 80)}...`
      : extractedMessage;

  if (total === 0) {
    return (
      `❌ *Broadcast failed.*\n` +
      `No verified parents found for *${className}*.\n` +
      `Please contact the school admin.`
    );
  }

  if (notReached === 0) {
    return (
      `✅ *Broadcast sent successfully.*\n\n` +
      `Class: *${className}*\n` +
      `Parents reached: *${reached}/${total}*\n` +
      `Message: "${preview}"`
    );
  }

  return (
    `⚠️ *Broadcast partially sent.*\n\n` +
    `Class: *${className}*\n` +
    `Parents reached: *${reached}/${total}*\n` +
    `Not reached: *${notReached}* parent${notReached !== 1 ? 's' : ''} (not yet verified on Telegram)\n` +
    `Message: "${preview}"`
  );
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Full broadcast pipeline called from the bot message handler.
 * Returns true if a broadcast was executed (caller should return early).
 * Returns false if the message was not a broadcast intent (caller continues to AI).
 */
export const handleBroadcastIfIntended = async (
  bot: TelegramBot,
  chatId: string,
  messageText: string,
  ctx: TeacherContext
): Promise<boolean> => {
  // ── 1. Classify intent (single AI call for all three types) ──────────────────
  const intent = await detectMessageIntent(messageText, ctx);

  // Clarification request — send question back to teacher, consume the message
  if (intent.intent === 'clarify') {
    await bot.sendMessage(chatId, intent.question);
    return true;
  }

  // Not a broadcast — let caller handle (student_message or normal)
  if (intent.intent !== 'broadcast') return false;

  // ── 2. Time guard — broadcasts only after 6 PM ────────────────────────────
  if (!isBroadcastWindowOpen()) {
    await bot.sendMessage(
      chatId,
      `⏰ Broadcasts are only sent after *${broadcastWindowOpensAt()}*.\nPlease try again later.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  // ── 3. Empty class guard ───────────────────────────────────────────────────
  const studentCount = await Student.countDocuments({
    class: ctx.className,
    status: 'active'
  });

  if (studentCount === 0) {
    await bot.sendMessage(
      chatId,
      `No students found in your assigned class (*${ctx.className}*).\nPlease contact the school admin.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  // ── 4. Resolve all parents in the class ───────────────────────────────────
  await bot.sendMessage(chatId, `📡 Sending broadcast to *${ctx.className}* parents...`, {
    parse_mode: 'Markdown'
  });

  const { targets, missed } = await resolveClassParents(ctx.className);

  // ── 5. Send to each parent (with per-parent error handling) ───────────────
  const { delivered, failed: sendFailed } = await sendToParents(
    bot,
    targets,
    ctx.className,
    intent.message
  );

  // ── 6. Log broadcast to Messages collection ────────────────────────────────
  const allFailed = [
    ...missed.map(m => m.studentId),
    ...sendFailed
  ];

  await logBroadcast(ctx, intent.message, delivered, allFailed);

  // ── 7. Report delivery summary to teacher ────────────────────────────────
  const summary = buildDeliverySummary(
    ctx.className,
    intent.message,
    delivered,
    missed,
    sendFailed
  );

  await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });

  logger.info(
    {
      teacher: ctx.teacher.fullName,
      className: ctx.className,
      delivered: delivered.length,
      missed: missed.length,
      sendFailed: sendFailed.length
    },
    'Broadcast complete'
  );

  return true;
};

// ─── Reusable job executor (called by scheduler worker) ──────────────────────

/**
 * Executes a broadcast for a scheduled job.
 * Reuses all existing send/log/summary helpers — no duplicated logic.
 * Returns a summary string the worker can log.
 */
export const executeBroadcastJob = async (
  bot: TelegramBot,
  teacherId: Types.ObjectId,
  teacherName: string,
  teacherChatId: string,
  className: string,
  message: string
): Promise<void> => {
  const { targets, missed } = await resolveClassParents(className);
  const { delivered, failed: sendFailed } = await sendToParents(bot, targets, className, message);

  const allFailed = [...missed.map(m => m.studentId), ...sendFailed];

  // Log using a minimal ctx-like object
  await Message.create({
    senderType: 'teacher',
    senderId: teacherId,
    recipientType: 'broadcast',
    targetClass: className,
    message,
    deliveredTo: delivered,
    failedTo: allFailed,
    status: allFailed.length === 0 ? 'sent' : delivered.length === 0 ? 'failed' : 'partial',
    sentAt: new Date()
  });

  const summary = buildDeliverySummary(className, message, delivered, missed, sendFailed);

  // Notify teacher of result
  try {
    await bot.sendMessage(teacherChatId, `🔔 *Scheduled broadcast sent:*\n\n${summary}`, {
      parse_mode: 'Markdown'
    });
  } catch {
    // Teacher may have changed chat — log and continue
    logger.warn({ teacherChatId }, 'Could not notify teacher of scheduled broadcast result');
  }

  logger.info(
    { teacherName, className, delivered: delivered.length, missed: missed.length },
    'Scheduled broadcast executed'
  );
};

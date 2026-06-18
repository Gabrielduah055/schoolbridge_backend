import TelegramBot from 'node-telegram-bot-api';
import { Types } from 'mongoose';
import Student, { type IStudent } from '../models/Students';
import Class from '../models/Class';
import StudentEnrollment from '../models/StudentEnrollment';
import Teacher from '../models/Teacher';
import TelegramIdentity from '../models/TelegramIdentity';
import Message from '../models/Message';
import { getPhoneLookupCandidates } from '../utils/phone';
import { chatWithSchoolAgent } from '../agents/schoolAgent';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import { logDelivery } from './communication/deliveryService';
import { getActiveAcademicYear } from './academic/academicYearService';
import { getClassTeacher } from './academic/teacherAssignmentService';
import logger from '../utils/logger';

// ─── Intent detection ─────────────────────────────────────────────────────────

interface TeacherMessageIntent {
  intent: 'message_teacher';
  message: string;
}

/**
 * Calls the AI to check whether the parent's message is a teacher-message intent.
 * The AI returns JSON only when the intent matches; otherwise it returns normal prose.
 * Returns a TeacherMessageIntent or null (caller handles as normal conversation).
 */
export const detectParentToTeacherIntent = async (
  messageText: string,
  parentPhone: string,
  parentName: string
): Promise<TeacherMessageIntent | null> => {
  let raw: string;
  try {
    raw = await chatWithSchoolAgent(
      [{ role: 'user', content: messageText }],
      'parent',
      parentPhone,
      parentName
    );
  } catch {
    return null; // AI failure → treat as normal conversation
  }

  // Extract first JSON block from the response
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { intent?: string; message?: string };
    if (parsed.intent === 'message_teacher' && parsed.message?.trim()) {
      return { intent: 'message_teacher', message: parsed.message.trim() };
    }
  } catch {
    // Malformed JSON — not an intent response
  }

  return null;
};

// ─── Child resolver ───────────────────────────────────────────────────────────

interface ChildChoice {
  studentId: Types.ObjectId;
  name: string;
  className: string;
}

/**
 * Finds all active students registered under the parent's phone number.
 * Returns an array — caller handles single / multiple / zero results.
 */
export const findChildrenByParentPhone = async (
  parentPhone: string
): Promise<ChildChoice[]> => {
  const candidates = getPhoneLookupCandidates(parentPhone);

  const students = await Student.find({
    status: 'active',
    $or: [
      { parentPhone:  { $in: candidates } },
      { parentPhone2: { $in: candidates } }
    ]
  }).select('name class') as unknown as Array<{ _id: Types.ObjectId; name: string; class: string }>;

  return students.map(s => ({
    studentId: s._id,
    name: s.name,
    className: s.class
  }));
};

const enrichChildrenWithCurrentEnrollment = async (children: ChildChoice[]): Promise<ChildChoice[]> => {
  const activeYear = await getActiveAcademicYear();
  if (!activeYear) return children;

  const enriched: ChildChoice[] = [];
  for (const child of children) {
    const enrollment = await StudentEnrollment.findOne({
      academicYearId: activeYear._id,
      studentId: child.studentId,
      status: 'active'
    }).populate('classId').lean();
    const classRecord = (enrollment as any)?.classId;
    enriched.push({
      ...child,
      className: classRecord?.name || classRecord?.className || child.className
    });
  }
  return enriched;
};

// ─── Teacher resolver ─────────────────────────────────────────────────────────

interface TeacherTarget {
  teacherId: Types.ObjectId;
  teacherName: string;
  teacherChatId: string;
  className: string;
}

/**
 * Given a student's class string, resolves the assigned active teacher
 * and their verified Telegram chatId.
 * Returns null with a reason at each broken link.
 */
export const resolveTeacherForClass = async (
  className: string
): Promise<
  | { ok: true; target: TeacherTarget }
  | { ok: false; reason: 'no_class' | 'no_teacher' | 'teacher_not_on_telegram' }
> => {
  // Step 1 — Find the class record
  const classRecord = await Class.findOne({
    active: true,
    $or: [{ name: className }, { className }]
  });
  if (!classRecord) return { ok: false, reason: 'no_class' };

  // Step 2 — Find the active teacher
  const activeYear = await getActiveAcademicYear();
  const assignment = activeYear
    ? await getClassTeacher(classRecord._id as Types.ObjectId, activeYear._id as Types.ObjectId)
    : null;
  const teacher = (assignment as any)?.teacherId || await Teacher.findById(classRecord.teacherId);
  if (!teacher || !teacher.active) return { ok: false, reason: 'no_teacher' };

  // Step 3 — Find teacher's Telegram identity
  const teacherIdentity = await TelegramIdentity.findOne({
    teacherId: teacher._id,
    status: 'teacher'
  }).select('chatId');

  if (!teacherIdentity?.chatId) {
    return { ok: false, reason: 'teacher_not_on_telegram' };
  }

  return {
    ok: true,
    target: {
      teacherId: teacher._id as Types.ObjectId,
      teacherName: teacher.fullName,
      teacherChatId: teacherIdentity.chatId,
      className: classRecord.name || classRecord.className
    }
  };
};

// ─── Message logger ───────────────────────────────────────────────────────────

const logParentToTeacherMessage = async (
  studentId: Types.ObjectId,
  teacherId: Types.ObjectId,
  className: string,
  message: string,
  status: 'sent' | 'failed'
): Promise<void> => {
  const savedMessage = await Message.create({
    schoolId: DEFAULT_SCHOOL_ID,
    channel: 'telegram',
    direction: 'outgoing',
    senderRole: 'parent',
    senderName: 'Parent',
    body: message,
    messageType: 'text',
    aiGenerated: false,
    senderType:    'parent',
    senderId:      studentId,       // child's Student document as sender reference
    recipientType: 'teacher',
    targetClass:   className,
    studentId,
    teacherId,
    message,
    deliveredTo:   [],
    failedTo:      [],
    status,
    sentAt: new Date()
  });

  await logDelivery({
    messageId: savedMessage._id as Types.ObjectId,
    channel: 'telegram',
    provider: 'telegram',
    eventType: 'parent_to_teacher_summary',
    status,
    rawPayload: {
      studentId: studentId.toString(),
      teacherId: teacherId.toString(),
      className
    }
  });
};

// ─── Multi-child session store ────────────────────────────────────────────────
// Lightweight in-memory map for parents choosing between multiple children.
// Keyed by chatId, expires after 5 minutes.

interface PendingChoice {
  children: ChildChoice[];
  message: string;       // the teacher message to forward once child is chosen
  expiresAt: number;
}

const pendingChoices = new Map<string, PendingChoice>();

const CHOICE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Clears stale entries — called lazily. */
const sweepPendingChoices = (): void => {
  const now = Date.now();
  for (const [key, val] of pendingChoices.entries()) {
    if (val.expiresAt < now) pendingChoices.delete(key);
  }
};

// ─── Delivery helpers ─────────────────────────────────────────────────────────

const formatForTeacher = (
  studentName: string,
  message: string
): string =>
  `💬 *Message from ${studentName}'s Parent*\n\n` +
  `${message}\n\n` +
  `— _SchoolBridge_`;

const previewText = (message: string): string =>
  message.length > 80 ? `${message.slice(0, 80)}...` : message;

// ─── Core delivery pipeline ───────────────────────────────────────────────────

const deliverToTeacher = async (
  bot: TelegramBot,
  chatId: string,
  child: ChildChoice,
  target: TeacherTarget,
  message: string
): Promise<void> => {
  const formatted = formatForTeacher(child.name, message);

  try {
    await bot.sendMessage(target.teacherChatId, formatted, { parse_mode: 'Markdown' });

    await logParentToTeacherMessage(child.studentId, target.teacherId, child.className, message, 'sent');

    await bot.sendMessage(
      chatId,
      `✅ *Your message has been sent to ${child.name.split(' ')[0]}'s class teacher.*\n\n` +
      `Message: "${previewText(message)}"\n\n` +
      `The teacher will be notified shortly.`,
      { parse_mode: 'Markdown' }
    );

    logger.info(
      { studentName: child.name, className: child.className, teacher: target.teacherName },
      'Parent-to-teacher message delivered'
    );

  } catch (err) {
    await logParentToTeacherMessage(child.studentId, target.teacherId, child.className, message, 'failed');

    await bot.sendMessage(
      chatId,
      `⚠️ *Your message could not be delivered to the teacher at this time.*\n` +
      `Please try again later or contact the school office directly.`,
      { parse_mode: 'Markdown' }
    );

    logger.error(
      { studentName: child.name, teacher: target.teacherName, err },
      'Parent-to-teacher message send failed'
    );
  }
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Main handler for the parent-to-teacher flow.
 *
 * Two entry points:
 *  1. Fresh intent detected — run the full pipeline.
 *  2. Parent is replying with a child selection ("1" or "2") — resume pending choice.
 *
 * Returns true if the message was handled (caller returns early).
 * Returns false if it was not a teacher-message intent (caller handles as normal AI).
 */
export const handleParentToTeacherIfIntended = async (
  bot: TelegramBot,
  chatId: string,
  messageText: string,
  parentPhone: string,
  parentName: string
): Promise<boolean> => {
  sweepPendingChoices();

  // ── A. Resume pending child selection ─────────────────────────────────────
  const pending = pendingChoices.get(chatId);
  if (pending) {
    const index = parseInt(messageText.trim(), 10);
    if (!isNaN(index) && index >= 1 && index <= pending.children.length) {
      pendingChoices.delete(chatId);
      const child = pending.children[index - 1];

      const result = await resolveTeacherForClass(child.className);

      if (!result.ok) {
        await bot.sendMessage(chatId, buildTeacherNotFoundMessage(result.reason, child.className));
        return true;
      }

      await deliverToTeacher(bot, chatId, child, result.target, pending.message);
      return true;
    }
    // Not a valid number — let it fall through so the AI handles it normally
    pendingChoices.delete(chatId);
  }

  // ── B. Detect fresh intent ────────────────────────────────────────────────
  const intent = await detectParentToTeacherIntent(messageText, parentPhone, parentName);
  if (!intent) return false; // Normal conversation — let caller handle

  const { message } = intent;

  if (!message.trim()) {
    await bot.sendMessage(
      chatId,
      `Please include the message content you want to send to the teacher.`
    );
    return true;
  }

  // ── C. Find parent's children ─────────────────────────────────────────────
  const children = await enrichChildrenWithCurrentEnrollment(await findChildrenByParentPhone(parentPhone));

  if (children.length === 0) {
    await bot.sendMessage(
      chatId,
      `I couldn't find a student linked to your phone number.\n` +
      `Please contact the school admin for assistance.`
    );
    return true;
  }

  // ── D. Multiple children → ask which one ─────────────────────────────────
  if (children.length > 1) {
    const list = children.map((c, i) => `${i + 1}. *${c.name}* — ${c.className}`).join('\n');

    pendingChoices.set(chatId, {
      children,
      message,
      expiresAt: Date.now() + CHOICE_TTL_MS
    });

    await bot.sendMessage(
      chatId,
      `You have more than one child registered.\n` +
      `Which child is this message about?\n\n${list}\n\n` +
      `Reply with *1* or *2* to continue.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  // ── E. Single child — proceed directly ────────────────────────────────────
  const child = children[0];
  const result = await resolveTeacherForClass(child.className);

  if (!result.ok) {
    await bot.sendMessage(chatId, buildTeacherNotFoundMessage(result.reason, child.className));
    return true;
  }

  await deliverToTeacher(bot, chatId, child, result.target, message);
  return true;
};

// ─── Error message builder ────────────────────────────────────────────────────

const buildTeacherNotFoundMessage = (
  reason: 'no_class' | 'no_teacher' | 'teacher_not_on_telegram',
  className: string
): string => {
  switch (reason) {
    case 'no_class':
      return (
        `Your child's class (*${className}*) is not yet configured on SchoolBridge.\n` +
        `Please contact the school office directly.`
      );
    case 'no_teacher':
      return (
        `Your child's class (*${className}*) currently has no assigned teacher on SchoolBridge.\n` +
        `Please contact the school office directly.`
      );
    case 'teacher_not_on_telegram':
      return (
        `⚠️ Your child's teacher has not yet set up their SchoolBridge account.\n` +
        `Your message could not be delivered.\n` +
        `Please contact the school office directly.`
      );
  }
};

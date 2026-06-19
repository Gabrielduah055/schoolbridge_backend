import TelegramBot from 'node-telegram-bot-api';
import Student from '../models/Students';
import { type TeacherContext } from './teacherAuthService';

const isStudentListRequest = (message: string) => {
  const text = message.toLowerCase();
  return (
    /\b(list|show|see|view|display)\b/.test(text) &&
    /\b(students|pupils|learners|class list)\b/.test(text)
  ) || /\bstudents\s+i\s+teach\b/.test(text);
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const mentionedClasses = (message: string, classes: string[]) => {
  const text = message.toLowerCase();
  return classes.filter((className) => text.includes(className.toLowerCase()));
};

const mentionedSubjectClasses = (message: string, ctx: TeacherContext) => {
  const text = message.toLowerCase();
  return ctx.subjectAssignments
    .filter((assignment) => text.includes(assignment.subject.toLowerCase()))
    .map((assignment) => assignment.className);
};

const resolveTargetClasses = (message: string, ctx: TeacherContext) => {
  const text = message.toLowerCase();
  const explicitClasses = mentionedClasses(message, ctx.teachingClasses);
  if (explicitClasses.length > 0) return unique(explicitClasses);

  const subjectClasses = mentionedSubjectClasses(message, ctx);
  if (subjectClasses.length > 0) return unique(subjectClasses);

  if (/\b(my class|class teacher|class i manage|my assigned class)\b/.test(text)) {
    return unique(ctx.classTeacherClasses);
  }

  return unique(ctx.teachingClasses);
};

const buildStudentListMessages = (
  classNames: string[],
  students: Array<{ name: string; admissionNumber?: string; class: string }>
) => {
  const grouped = new Map<string, Array<{ name: string; admissionNumber?: string }>>();
  for (const student of students) {
    const rows = grouped.get(student.class) || [];
    rows.push({ name: student.name, admissionNumber: student.admissionNumber });
    grouped.set(student.class, rows);
  }

  const sections = classNames.map((className) => {
    const rows = grouped.get(className) || [];
    if (rows.length === 0) return `*${className}*\nNo active students found.`;

    return [
      `*${className}* (${rows.length})`,
      ...rows.map((student, index) => `${index + 1}. ${student.name}${student.admissionNumber ? ` - ${student.admissionNumber}` : ''}`)
    ].join('\n');
  });

  const messages: string[] = [];
  let current = 'Students you are allowed to view:\n\n';

  for (const section of sections) {
    if ((current + '\n\n' + section).length > 3500) {
      messages.push(current.trim());
      current = '';
    }
    current = current ? `${current}\n\n${section}` : section;
  }

  if (current.trim()) messages.push(current.trim());
  return messages;
};

export const handleTeacherStudentListIfIntended = async (
  bot: TelegramBot,
  chatId: string,
  messageText: string,
  ctx: TeacherContext
): Promise<boolean> => {
  if (!isStudentListRequest(messageText)) return false;

  const targetClasses = resolveTargetClasses(messageText, ctx);
  if (targetClasses.length === 0) {
    await bot.sendMessage(
      chatId,
      'I could not find any class or subject assignment for you yet. Please ask the school admin to update the teacher directory.'
    );
    return true;
  }

  const students = await Student.find({
    status: 'active',
    class: { $in: targetClasses }
  }).sort({ class: 1, name: 1 }).select('name admissionNumber class').lean();

  const messages = buildStudentListMessages(
    targetClasses,
    students as Array<{ name: string; admissionNumber?: string; class: string }>
  );

  for (const message of messages) {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  return true;
};

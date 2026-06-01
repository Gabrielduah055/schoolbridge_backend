import TelegramIdentity from '../models/TelegramIdentity';
import Teacher, { type ITeacher } from '../models/Teacher';
import Class, { type IClass } from '../models/Class';
import Student, { type IStudent } from '../models/Students';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TeacherContext = {
  teacher: ITeacher;
  assignedClass: IClass;
  className: string;
};

// ─── Teacher Context Loader ───────────────────────────────────────────────────

/**
 * Resolves the full authorization context for a verified teacher.
 *
 * Chain:
 *   TelegramIdentity (chatId + status:"teacher")
 *     → Teacher (active)
 *       → Class (teacherId + active)
 *
 * Returns null at any broken link — callers must treat null as "deny".
 */
export const getTeacherContext = async (
  chatId: string
): Promise<TeacherContext | null> => {
  // Step 1 — Find a verified teacher identity for this chat
  const identity = await TelegramIdentity.findOne({
    chatId,
    status: 'teacher'
  });

  if (!identity || !identity.teacherId) return null;

  // Step 2 — Load the Teacher document and confirm it is active
  const teacher = await Teacher.findById(identity.teacherId);

  if (!teacher || !teacher.active) return null;

  // Step 3 — Find the Class assigned to this teacher
  const assignedClass = await Class.findOne({
    teacherId: teacher._id,
    active: true
  });

  if (!assignedClass) return null;

  return {
    teacher,
    assignedClass,
    className: assignedClass.className
  };
};

// ─── Student Ownership Check ──────────────────────────────────────────────────

/**
 * Checks whether a student with the given name exists in the teacher's class.
 * Match is case-insensitive on name, exact on className (already validated
 * by getTeacherContext before this is called).
 *
 * Returns the Student document if found, null otherwise.
 */
export const isStudentInTeacherClass = async (
  studentName: string,
  className: string
): Promise<IStudent | null> => {
  if (!studentName || !className) return null;

  return Student.findOne({
    status: 'active',
    class: className,
    name: { $regex: new RegExp(studentName.trim(), 'i') }
  });
};

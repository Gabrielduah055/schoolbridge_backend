import Student, { type IStudent } from '../models/Students';
import Teacher, { type ITeacher } from '../models/Teacher';
import { getPhoneLookupCandidates, normalizePhoneNumber } from '../utils/phone';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TeacherInfo {
  name:      string;
  phone:     string;  // normalized to local 0XXXXXXXXX format
  role:      'teacher';
  teacherId: string;  // Teacher _id as a string
}

export interface ParentInfo {
  name:  string;
  phone: string;  // normalized to local 0XXXXXXXXX format
  role:  'parent';
}

// ─── Teacher lookup ────────────────────────────────────────────────────────────

/**
 * Looks up a teacher by phone number in the Teachers collection.
 * Returns null if no active teacher has this phone number registered.
 */
export const findTeacherByPhone = async (
  phoneNumber: string
): Promise<TeacherInfo | null> => {
  const phoneCandidates = getPhoneLookupCandidates(phoneNumber);

  const teacher = await Teacher.findOne({
    active: true,
    phone: { $in: phoneCandidates }
  });

  if (!teacher) return null;

  return {
    name:      teacher.fullName,
    phone:     normalizePhoneNumber(phoneNumber),
    role:      'teacher',
    teacherId: teacher._id.toString()
  };
};

// ─── Parent lookup ─────────────────────────────────────────────────────────────

/**
 * Looks up a parent by phone number in the Students collection (source of truth).
 * Returns null if no active student has this phone as a parent/guardian contact.
 * Never creates User documents — identification is read-only.
 */
export const findParentByPhone = async (
  phoneNumber: string
): Promise<ParentInfo | null> => {
  const phoneCandidates = getPhoneLookupCandidates(phoneNumber);

  const student = await Student.findOne({
    status: 'active',
    $or: [
      { parentPhone:  { $in: phoneCandidates } },
      { parentPhone2: { $in: phoneCandidates } }
    ]
  });

  if (!student) return null;

  return {
    name:  student.parentName || 'Parent',
    phone: normalizePhoneNumber(phoneNumber),
    role:  'parent'
  };
};

/**
 * Returns all active students owned by a phone number.
 * "Owned" means the number appears in parentPhone or parentPhone2.
 * Results are sorted by class then name for consistent display order.
 */
export const findParentStudents = async (
  phoneNumber: string
): Promise<IStudent[]> => {
  const phoneCandidates = getPhoneLookupCandidates(phoneNumber);

  return Student.find({
    status: 'active',
    $or: [
      { parentPhone:  { $in: phoneCandidates } },
      { parentPhone2: { $in: phoneCandidates } }
    ]
  }).sort({ class: 1, name: 1 });
};

// ─── Ownership check ──────────────────────────────────────────────────────────

/**
 * Returns true if the phone number is listed as parent/guardian on the given student.
 * Used by the access guard to allow/deny questions about a specific child.
 */
export const phoneOwnsStudent = (
  student: IStudent,
  phoneNumber: string
): boolean => {
  const phoneCandidates = getPhoneLookupCandidates(phoneNumber);

  return [student.parentPhone, student.parentPhone2].some(storedPhone =>
    storedPhone &&
    (
      phoneCandidates.includes(normalizePhoneNumber(storedPhone)) ||
      phoneCandidates.includes(storedPhone)
    )
  );
};

// ─── Student name search ──────────────────────────────────────────────────────

const normalizeForSearch = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Scans the message for a student's full name or admission number.
 * Returns the first matching student, or null.
 *
 * Intentionally requires a full name (contains a space) to avoid false
 * positives from common first names like "Kwame" or "Ama" appearing in
 * unrelated sentences.
 */
export const findStudentMentionedInMessage = async (
  messageText: string
): Promise<IStudent | null> => {
  const normalizedMessage = ` ${normalizeForSearch(messageText)} `;

  const students = await Student.find({ status: 'active' })
    .select('name admissionNumber class parentPhone parentPhone2')
    .limit(300);

  return students.find(student => {
    const normalizedName = normalizeForSearch(student.name);
    const normalizedAdmission = normalizeForSearch(student.admissionNumber || '');

    const nameMatch = Boolean(
      normalizedName &&
      normalizedName.includes(' ') &&             // full name required
      normalizedMessage.includes(` ${normalizedName} `)
    );

    const admissionMatch = Boolean(
      normalizedAdmission &&
      normalizedMessage.includes(` ${normalizedAdmission} `)
    );

    return nameMatch || admissionMatch;
  }) ?? null;
};

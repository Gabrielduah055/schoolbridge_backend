import { Types } from 'mongoose';
import Student from '../../models/Students';
import StudentEnrollment from '../../models/StudentEnrollment';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { getActiveAcademicYear } from './academicYearService';

interface Actor {
  id?: string;
  name?: string;
}

const actorFields = (actor?: Actor) => ({
  ...(actor?.id && Types.ObjectId.isValid(actor.id) ? { createdBy: new Types.ObjectId(actor.id) } : {}),
  createdByName: actor?.name || ''
});

const enderFields = (actor?: Actor) => ({
  ...(actor?.id && Types.ObjectId.isValid(actor.id) ? { endedBy: new Types.ObjectId(actor.id) } : {}),
  endedByName: actor?.name || '',
  endedAt: new Date()
});

const assertActiveStudent = async (studentId: string) => {
  const student = await Student.findById(studentId);
  if (!student || student.status !== 'active') throw new Error('Cannot enroll inactive or missing student');
  return student;
};

export const enrollStudent = async (input: {
  schoolId?: string;
  academicYearId: string;
  studentId: string;
  classId: string;
  startDate?: Date;
  actor?: Actor;
}) => {
  const schoolId = input.schoolId || DEFAULT_SCHOOL_ID;
  await assertActiveStudent(input.studentId);
  const existing = await StudentEnrollment.findOne({
    schoolId,
    academicYearId: input.academicYearId,
    studentId: input.studentId,
    status: 'active'
  });
  if (existing) throw new Error('Student already has an active enrollment for this academic year');

  return StudentEnrollment.create({
    schoolId,
    academicYearId: input.academicYearId,
    studentId: input.studentId,
    classId: input.classId,
    status: 'active',
    startDate: input.startDate || new Date(),
    ...actorFields(input.actor)
  });
};

export const getStudentCurrentEnrollment = async (studentId: string, schoolId = DEFAULT_SCHOOL_ID) => {
  const activeYear = await getActiveAcademicYear(schoolId);
  if (!activeYear) return null;
  return StudentEnrollment.findOne({
    schoolId,
    academicYearId: activeYear._id,
    studentId,
    status: 'active'
  }).populate('academicYearId').populate('classId');
};

export const getStudentEnrollments = (studentId: string, schoolId = DEFAULT_SCHOOL_ID) =>
  StudentEnrollment.find({ schoolId, studentId })
    .populate('academicYearId')
    .populate('classId')
    .sort({ startDate: -1, createdAt: -1 });

export const getStudentsInClass = (classId: string, academicYearId: string, schoolId = DEFAULT_SCHOOL_ID) =>
  StudentEnrollment.find({
    schoolId,
    academicYearId,
    classId,
    status: 'active'
  }).populate('studentId').sort({ createdAt: -1 });

export const endEnrollment = async (id: string, input: {
  schoolId?: string;
  status?: 'promoted' | 'repeated' | 'transferred' | 'withdrawn' | 'graduated';
  reason?: string;
  endDate?: Date;
  actor?: Actor;
}) => {
  const enrollment = await StudentEnrollment.findOne({ _id: id, schoolId: input.schoolId || DEFAULT_SCHOOL_ID });
  if (!enrollment) throw new Error('Student enrollment not found');
  enrollment.status = input.status || 'transferred';
  enrollment.endDate = input.endDate || new Date();
  enrollment.endReason = input.reason || 'Enrollment ended';
  Object.assign(enrollment, enderFields(input.actor));
  await enrollment.save();
  return enrollment;
};

export const promoteStudents = async (input: {
  schoolId?: string;
  fromAcademicYearId: string;
  toAcademicYearId: string;
  moves: Array<{ studentId: string; fromEnrollmentId?: string; toClassId: string; status?: 'promoted' | 'repeated' }>;
  actor?: Actor;
}) => {
  const schoolId = input.schoolId || DEFAULT_SCHOOL_ID;
  const created = [];
  for (const move of input.moves) {
    const current = move.fromEnrollmentId
      ? await StudentEnrollment.findOne({ _id: move.fromEnrollmentId, schoolId })
      : await StudentEnrollment.findOne({
          schoolId,
          academicYearId: input.fromAcademicYearId,
          studentId: move.studentId,
          status: 'active'
        });

    if (current) {
      current.status = move.status || 'promoted';
      current.endDate = new Date();
      current.endReason = 'Promoted to next academic year';
      Object.assign(current, enderFields(input.actor));
      await current.save();
    }

    created.push(await enrollStudent({
      schoolId,
      academicYearId: input.toAcademicYearId,
      studentId: move.studentId,
      classId: move.toClassId,
      actor: input.actor
    }));
  }
  return created;
};

export const listStudentEnrollments = (filter: {
  schoolId?: string;
  academicYearId?: string;
  studentId?: string;
  classId?: string;
  status?: string;
}) => {
  const query: Record<string, unknown> = {
    schoolId: filter.schoolId || DEFAULT_SCHOOL_ID,
    ...(filter.academicYearId ? { academicYearId: filter.academicYearId } : {}),
    ...(filter.studentId ? { studentId: filter.studentId } : {}),
    ...(filter.classId ? { classId: filter.classId } : {}),
    ...(filter.status ? { status: filter.status } : {})
  };

  return StudentEnrollment.find(query).populate('academicYearId').populate('studentId').populate('classId').sort({ createdAt: -1 });
};

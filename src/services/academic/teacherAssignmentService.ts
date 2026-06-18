import { Types } from 'mongoose';
import AcademicYear from '../../models/AcademicYear';
import Class from '../../models/Class';
import Subject from '../../models/Subject';
import Teacher from '../../models/Teacher';
import TeacherAssignment from '../../models/TeacherAssignment';
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

const assertActiveTeacher = async (teacherId: string) => {
  const teacher = await Teacher.findById(teacherId);
  if (!teacher || !teacher.active) throw new Error('Cannot assign inactive or missing teacher');
  return teacher;
};

export const assignClassTeacher = async (input: {
  schoolId?: string;
  academicYearId: string;
  teacherId: string;
  classId: string;
  startDate?: Date;
  actor?: Actor;
}) => {
  const schoolId = input.schoolId || DEFAULT_SCHOOL_ID;
  await assertActiveTeacher(input.teacherId);
  const existing = await TeacherAssignment.findOne({
    schoolId,
    academicYearId: input.academicYearId,
    classId: input.classId,
    assignmentType: 'class_teacher',
    isActive: true
  });
  if (existing) throw new Error('This class already has an active class teacher for the academic year');

  return TeacherAssignment.create({
    schoolId,
    academicYearId: input.academicYearId,
    teacherId: input.teacherId,
    classId: input.classId,
    assignmentType: 'class_teacher',
    startDate: input.startDate || new Date(),
    isActive: true,
    ...actorFields(input.actor)
  });
};

export const replaceClassTeacher = async (input: {
  schoolId?: string;
  academicYearId: string;
  classId: string;
  newTeacherId: string;
  startDate?: Date;
  reason?: string;
  actor?: Actor;
}) => {
  const schoolId = input.schoolId || DEFAULT_SCHOOL_ID;
  await assertActiveTeacher(input.newTeacherId);
  const existing = await TeacherAssignment.findOne({
    schoolId,
    academicYearId: input.academicYearId,
    classId: input.classId,
    assignmentType: 'class_teacher',
    isActive: true
  });

  if (existing) {
    existing.isActive = false;
    existing.endDate = input.startDate || new Date();
    existing.endReason = input.reason || 'Class teacher replaced';
    Object.assign(existing, enderFields(input.actor));
    await existing.save();
  }

  return assignClassTeacher({
    schoolId,
    academicYearId: input.academicYearId,
    classId: input.classId,
    teacherId: input.newTeacherId,
    startDate: input.startDate,
    actor: input.actor
  });
};

export const assignSubjectTeacher = async (input: {
  schoolId?: string;
  academicYearId: string;
  teacherId: string;
  classId: string;
  subjectId?: string;
  subjectName?: string;
  startDate?: Date;
  actor?: Actor;
}) => {
  const schoolId = input.schoolId || DEFAULT_SCHOOL_ID;
  await assertActiveTeacher(input.teacherId);
  let subjectName = input.subjectName || '';
  if (input.subjectId) {
    const subject = await Subject.findOne({ _id: input.subjectId, schoolId, active: true });
    if (!subject) throw new Error('Subject not found or inactive');
    subjectName = subject.name;
  }
  if (!input.subjectId && !subjectName) throw new Error('Subject teacher assignment requires a subject');

  return TeacherAssignment.create({
    schoolId,
    academicYearId: input.academicYearId,
    teacherId: input.teacherId,
    classId: input.classId,
    assignmentType: 'subject_teacher',
    subjectId: input.subjectId || undefined,
    subjectName,
    startDate: input.startDate || new Date(),
    isActive: true,
    ...actorFields(input.actor)
  });
};

export const endTeacherAssignment = async (id: string, input: {
  schoolId?: string;
  reason?: string;
  endDate?: Date;
  actor?: Actor;
}) => {
  const assignment = await TeacherAssignment.findOne({ _id: id, schoolId: input.schoolId || DEFAULT_SCHOOL_ID });
  if (!assignment) throw new Error('Teacher assignment not found');

  assignment.isActive = false;
  assignment.endDate = input.endDate || new Date();
  assignment.endReason = input.reason || 'Assignment ended';
  Object.assign(assignment, enderFields(input.actor));
  await assignment.save();
  return assignment;
};

export const getTeacherAssignments = (teacherId: string, schoolId = DEFAULT_SCHOOL_ID) =>
  TeacherAssignment.find({ teacherId, schoolId })
    .populate('academicYearId')
    .populate('classId')
    .populate('subjectId')
    .sort({ isActive: -1, startDate: -1 });

export const getClassTeacher = (classId: Types.ObjectId | string, academicYearId: Types.ObjectId | string, schoolId = DEFAULT_SCHOOL_ID) =>
  TeacherAssignment.findOne({
    schoolId,
    academicYearId,
    classId,
    assignmentType: 'class_teacher',
    isActive: true
  }).populate('teacherId');

export const getClassSubjectTeachers = (classId: Types.ObjectId | string, academicYearId: Types.ObjectId | string, schoolId = DEFAULT_SCHOOL_ID) =>
  TeacherAssignment.find({
    schoolId,
    academicYearId,
    classId,
    assignmentType: 'subject_teacher',
    isActive: true
  }).populate('teacherId').populate('subjectId').sort({ subjectName: 1 });

export const getTeacherCommunicationScope = async (teacherId: string, schoolId = DEFAULT_SCHOOL_ID) => {
  const activeYear = await getActiveAcademicYear(schoolId);
  if (!activeYear) {
    return { activeAcademicYear: null, classTeacherClasses: [], subjectTeacherClasses: [], fallback: true };
  }

  const assignments = await TeacherAssignment.find({
    schoolId,
    academicYearId: activeYear._id,
    teacherId,
    isActive: true
  }).populate('classId').populate('subjectId').lean();

  return {
    activeAcademicYear: activeYear,
    classTeacherClasses: assignments.filter((item) => item.assignmentType === 'class_teacher'),
    subjectTeacherClasses: assignments.filter((item) => item.assignmentType === 'subject_teacher'),
    fallback: assignments.length === 0
  };
};

export const listTeacherAssignments = (filter: {
  schoolId?: string;
  academicYearId?: string;
  teacherId?: string;
  classId?: string;
  assignmentType?: 'class_teacher' | 'subject_teacher';
  isActive?: boolean;
}) => TeacherAssignment.find({
  schoolId: filter.schoolId || DEFAULT_SCHOOL_ID,
  ...(filter.academicYearId ? { academicYearId: filter.academicYearId } : {}),
  ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
  ...(filter.classId ? { classId: filter.classId } : {}),
  ...(filter.assignmentType ? { assignmentType: filter.assignmentType } : {}),
  ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {})
}).populate('academicYearId').populate('teacherId').populate('classId').populate('subjectId').sort({ isActive: -1, startDate: -1 });

export const getTeacherClassFallback = async (teacherId: string) => {
  const classRecord = await Class.findOne({ teacherId, active: true });
  const activeYear = await AcademicYear.findOne({ isActive: true, status: 'active' });
  return { classRecord, activeYear };
};

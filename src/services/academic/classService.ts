import { Types } from 'mongoose';
import Class from '../../models/Class';
import Student from '../../models/Students';
import Broadcast from '../../models/Broadcast';
import StudentEnrollment from '../../models/StudentEnrollment';
import { DEFAULT_SCHOOL_ID } from '../../config/school';
import { normalizePhoneNumber } from '../../utils/phone';
import { getActiveAcademicYear } from './academicYearService';
import { getClassTeacher, getClassSubjectTeachers } from './teacherAssignmentService';

export const createClass = (input: {
  schoolId?: string;
  name: string;
  level?: string;
  section?: string;
  displayName?: string;
  active?: boolean;
}) => Class.create({
  schoolId: input.schoolId || DEFAULT_SCHOOL_ID,
  name: input.name,
  className: input.name,
  level: input.level || '',
  section: input.section || '',
  displayName: input.displayName || '',
  active: input.active !== false
});

export const updateClass = (id: string, input: Partial<{
  name: string;
  className: string;
  level: string;
  section: string;
  displayName: string;
  active: boolean;
}>, schoolId = DEFAULT_SCHOOL_ID) =>
  Class.findOneAndUpdate({ _id: id, schoolId }, { $set: input }, { new: true });

export const listClasses = (schoolId = DEFAULT_SCHOOL_ID) =>
  Class.find({ schoolId }).sort({ active: -1, name: 1, className: 1 });

export const getClassById = (id: string, schoolId = DEFAULT_SCHOOL_ID) =>
  Class.findOne({ _id: id, schoolId });

export const getClassParents = async (classId: string, schoolId = DEFAULT_SCHOOL_ID) => {
  const classRecord = await getClassById(classId, schoolId);
  if (!classRecord) throw new Error('Class not found');

  const activeYear = await getActiveAcademicYear(schoolId);
  let students: any[] = [];

  if (activeYear) {
    const enrollments = await StudentEnrollment.find({
      schoolId,
      academicYearId: activeYear._id,
      classId: classRecord._id,
      status: 'active'
    }).populate('studentId').lean();
    students = enrollments.map((enrollment: any) => enrollment.studentId).filter(Boolean);
  }

  if (students.length === 0) {
    students = await Student.find({ status: 'active', class: classRecord.name || classRecord.className }).lean();
  }

  return students
    .filter((student: any) => student.parentPhone)
    .map((student: any) => ({
      student: {
        id: student._id,
        name: student.name,
        admissionNumber: student.admissionNumber
      },
      parentName: student.parentName || 'Parent',
      parentPhone: normalizePhoneNumber(student.parentPhone),
      parentPhone2: normalizePhoneNumber(student.parentPhone2 || ''),
      parentEmail: student.parentEmail || '',
      className: classRecord.name || classRecord.className
    }));
};

export const getClassSummary = async (classId: string, schoolId = DEFAULT_SCHOOL_ID) => {
  const classRecord = await getClassById(classId, schoolId);
  if (!classRecord) throw new Error('Class not found');

  const activeYear = await getActiveAcademicYear(schoolId);
  const classTeacher = activeYear
    ? await getClassTeacher(classRecord._id as Types.ObjectId, activeYear._id as Types.ObjectId, schoolId)
    : null;
  const subjectTeachers = activeYear
    ? await getClassSubjectTeachers(classRecord._id as Types.ObjectId, activeYear._id as Types.ObjectId, schoolId)
    : [];

  const parents = await getClassParents(classId, schoolId);
  const students = activeYear
    ? await StudentEnrollment.find({
        schoolId,
        academicYearId: activeYear._id,
        classId: classRecord._id,
        status: 'active'
      }).populate('studentId').lean()
    : [];
  const fallbackStudents = students.length > 0
    ? []
    : await Student.find({ status: 'active', class: classRecord.name || classRecord.className }).lean();

  return {
    class: classRecord,
    activeAcademicYear: activeYear,
    classTeacher,
    subjectTeachers,
    studentCount: students.length || fallbackStudents.length,
    parentContactCount: parents.length,
    parents,
    students: students.length > 0 ? students.map((item: any) => item.studentId).filter(Boolean) : fallbackStudents,
    recentBroadcastCount: await Broadcast.countDocuments({
      schoolId,
      targetClass: classRecord.name || classRecord.className,
      status: { $in: ['sent', 'partially_failed'] }
    }),
    warnings: {
      noActiveAcademicYear: !activeYear,
      noClassTeacher: !classTeacher,
      noActiveStudents: (students.length || fallbackStudents.length) === 0
    }
  };
};

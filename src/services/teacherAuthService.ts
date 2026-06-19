import TelegramIdentity from '../models/TelegramIdentity';
import Teacher, { type ITeacher } from '../models/Teacher';
import Class, { type IClass } from '../models/Class';
import Student, { type IStudent } from '../models/Students';

export type TeacherContext = {
  teacher: ITeacher;
  assignedClass: IClass;
  className: string;
  classTeacherClasses: string[];
  subjectAssignments: Array<{ className: string; subject: string }>;
  teachingClasses: string[];
};

const parseSubjectAssignmentText = (value = '') => value
  .split(/[,;/|]/)
  .map((item: string) => {
    const [className, ...subjectParts] = item.split(':');
    return {
      className: className?.trim() || '',
      subject: subjectParts.join(':').trim()
    };
  })
  .filter((item) => item.className && item.subject);

export const getTeacherContext = async (
  chatId: string
): Promise<TeacherContext | null> => {
  const identity = await TelegramIdentity.findOne({
    chatId,
    status: 'teacher'
  });

  if (!identity || !identity.teacherId) return null;

  const teacher = await Teacher.findById(identity.teacherId);
  if (!teacher || !teacher.active) return null;

  const savedSubjectAssignments = teacher.subjectAssignments || [];
  const subjectAssignments = savedSubjectAssignments.length > 0
    ? savedSubjectAssignments
    : parseSubjectAssignmentText(teacher.subject);
  const assignedClasses = await Class.find({
    teacherId: teacher._id,
    active: true
  }).sort({ className: 1, name: 1 });

  const classTeacherClasses = assignedClasses
    .map((item) => item.name || item.className)
    .filter(Boolean);
  const teachingClasses = Array.from(new Set([
    ...classTeacherClasses,
    ...subjectAssignments.map((item) => item.className).filter(Boolean)
  ]));

  if (teachingClasses.length === 0) return null;

  const assignedClass = assignedClasses[0] || await Class.findOne({
    active: true,
    $or: [
      { className: teachingClasses[0] },
      { name: teachingClasses[0] }
    ]
  });

  if (!assignedClass) return null;

  return {
    teacher,
    assignedClass,
    className: assignedClass.name || assignedClass.className,
    classTeacherClasses,
    subjectAssignments,
    teachingClasses
  };
};

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

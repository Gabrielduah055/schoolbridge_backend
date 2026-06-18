import TelegramIdentity from '../models/TelegramIdentity';
import Teacher, { type ITeacher } from '../models/Teacher';
import Class, { type IClass } from '../models/Class';
import Student, { type IStudent } from '../models/Students';

export type TeacherContext = {
  teacher: ITeacher;
  assignedClass: IClass;
  className: string;
};

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

  const assignedClass = await Class.findOne({
    teacherId: teacher._id,
    active: true
  });

  if (!assignedClass) return null;

  return {
    teacher,
    assignedClass,
    className: assignedClass.name || assignedClass.className
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

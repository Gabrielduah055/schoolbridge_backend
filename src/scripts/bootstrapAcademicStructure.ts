import 'dotenv/config';
import { Types } from 'mongoose';
import connectDB from '../config/db';
import AcademicYear from '../models/AcademicYear';
import Class from '../models/Class';
import Student from '../models/Students';
import StudentEnrollment from '../models/StudentEnrollment';
import { DEFAULT_SCHOOL_ID } from '../config/school';
import logger from '../utils/logger';

const currentAcademicYearName = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 8 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
};

const main = async () => {
  await connectDB();

  const name = currentAcademicYearName();
  let academicYear = await AcademicYear.findOne({ schoolId: DEFAULT_SCHOOL_ID, name });

  if (!academicYear) {
    const startYear = Number(name.split('/')[0]);
    academicYear = await AcademicYear.create({
      schoolId: DEFAULT_SCHOOL_ID,
      name,
      startDate: new Date(Date.UTC(startYear, 8, 1)),
      endDate: new Date(Date.UTC(startYear + 1, 6, 31)),
      isActive: true,
      status: 'active'
    });
    await AcademicYear.updateMany(
      { schoolId: DEFAULT_SCHOOL_ID, _id: { $ne: academicYear._id }, isActive: true },
      { $set: { isActive: false, status: 'upcoming' } }
    );
    logger.info({ academicYear: name }, 'Created active academic year');
  } else if (!academicYear.isActive) {
    await AcademicYear.updateMany(
      { schoolId: DEFAULT_SCHOOL_ID, _id: { $ne: academicYear._id }, isActive: true },
      { $set: { isActive: false, status: 'upcoming' } }
    );
    academicYear.isActive = true;
    academicYear.status = 'active';
    await academicYear.save();
    logger.info({ academicYear: name }, 'Set academic year active');
  }

  const students = await Student.find({ status: 'active' }).lean();
  const classNames = Array.from(new Set(students.map((student: any) => student.class).filter(Boolean))).sort();
  let classesCreated = 0;
  let enrollmentsCreated = 0;
  const classByName = new Map<string, any>();

  for (const className of classNames) {
    let classRecord = await Class.findOne({
      schoolId: DEFAULT_SCHOOL_ID,
      $or: [{ name: className }, { className }]
    });

    if (!classRecord) {
      classRecord = await Class.create({
        schoolId: DEFAULT_SCHOOL_ID,
        name: className,
        className,
        displayName: className,
        active: true
      });
      classesCreated++;
    }

    classByName.set(className, classRecord);
  }

  for (const student of students as any[]) {
    const classRecord = classByName.get(student.class);
    if (!classRecord) continue;

    const existing = await StudentEnrollment.findOne({
      schoolId: DEFAULT_SCHOOL_ID,
      academicYearId: academicYear._id,
      studentId: student._id,
      status: 'active'
    });

    if (existing) continue;

    await StudentEnrollment.create({
      schoolId: DEFAULT_SCHOOL_ID,
      academicYearId: academicYear._id as Types.ObjectId,
      studentId: student._id,
      classId: classRecord._id,
      status: 'active',
      startDate: student.dateEnrolled || new Date()
    });
    enrollmentsCreated++;
  }

  logger.info({
    academicYear: academicYear.name,
    classesCreated,
    enrollmentsCreated,
    activeStudentsSeen: students.length
  }, 'Academic structure bootstrap complete');

  process.exit(0);
};

main().catch((error) => {
  logger.error({ err: error }, 'Academic structure bootstrap failed');
  process.exit(1);
});

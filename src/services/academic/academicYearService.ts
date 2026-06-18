import AcademicYear from '../../models/AcademicYear';
import { DEFAULT_SCHOOL_ID } from '../../config/school';

export const listAcademicYears = (schoolId = DEFAULT_SCHOOL_ID) =>
  AcademicYear.find({ schoolId }).sort({ startDate: -1, createdAt: -1 });

export const getActiveAcademicYear = (schoolId = DEFAULT_SCHOOL_ID) =>
  AcademicYear.findOne({ schoolId, isActive: true, status: 'active' });

export const createAcademicYear = async (input: {
  schoolId?: string;
  name: string;
  startDate: Date;
  endDate: Date;
  isActive?: boolean;
}) => {
  const schoolId = input.schoolId || DEFAULT_SCHOOL_ID;
  if (input.isActive) {
    await AcademicYear.updateMany({ schoolId, isActive: true }, { $set: { isActive: false, status: 'upcoming' } });
  }

  return AcademicYear.create({
    schoolId,
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    isActive: Boolean(input.isActive),
    status: input.isActive ? 'active' : 'upcoming'
  });
};

export const setActiveAcademicYear = async (id: string, schoolId = DEFAULT_SCHOOL_ID) => {
  const academicYear = await AcademicYear.findOne({ _id: id, schoolId });
  if (!academicYear) throw new Error('Academic year not found');

  await AcademicYear.updateMany({ schoolId, isActive: true, _id: { $ne: academicYear._id } }, {
    $set: { isActive: false, status: 'upcoming' }
  });

  academicYear.isActive = true;
  academicYear.status = 'active';
  await academicYear.save();
  return academicYear;
};

export const closeAcademicYear = async (id: string, schoolId = DEFAULT_SCHOOL_ID) => {
  const academicYear = await AcademicYear.findOne({ _id: id, schoolId });
  if (!academicYear) throw new Error('Academic year not found');

  academicYear.isActive = false;
  academicYear.status = 'closed';
  await academicYear.save();
  return academicYear;
};

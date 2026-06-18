import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IStudentEnrollment extends Document {
  schoolId: string;
  academicYearId: Types.ObjectId;
  studentId: Types.ObjectId;
  classId: Types.ObjectId;
  status: 'active' | 'promoted' | 'repeated' | 'transferred' | 'withdrawn' | 'graduated';
  startDate: Date;
  endDate?: Date | null;
  createdBy?: Types.ObjectId;
  createdByName: string;
  endedBy?: Types.ObjectId;
  endedByName: string;
  endedAt?: Date | null;
  endReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const StudentEnrollmentSchema = new Schema<IStudentEnrollment>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'promoted', 'repeated', 'transferred', 'withdrawn', 'graduated'],
      default: 'active',
      index: true
    },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    createdByName: { type: String, default: '' },
    endedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    endedByName: { type: String, default: '' },
    endedAt: { type: Date, default: null },
    endReason: { type: String, default: '' }
  },
  { timestamps: true }
);

StudentEnrollmentSchema.index({ schoolId: 1, academicYearId: 1, studentId: 1, status: 1 });
StudentEnrollmentSchema.index({ schoolId: 1, academicYearId: 1, classId: 1, status: 1 });
StudentEnrollmentSchema.index(
  { schoolId: 1, academicYearId: 1, studentId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' }
  }
);

export default mongoose.model<IStudentEnrollment>('StudentEnrollment', StudentEnrollmentSchema);

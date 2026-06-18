import mongoose, { Schema, Document } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IAcademicYear extends Document {
  schoolId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  status: 'upcoming' | 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

const AcademicYearSchema = new Schema<IAcademicYear>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    name: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'closed'],
      default: 'upcoming',
      index: true
    }
  },
  { timestamps: true }
);

AcademicYearSchema.index({ schoolId: 1, name: 1 }, { unique: true });
AcademicYearSchema.index(
  { schoolId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

export default mongoose.model<IAcademicYear>('AcademicYear', AcademicYearSchema);

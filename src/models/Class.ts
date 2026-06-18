import mongoose, { Schema, Document, Types } from 'mongoose';
import { DEFAULT_SCHOOL_ID } from '../config/school';

export interface IClass extends Document {
  schoolId: string;
  name: string;
  className: string;
  level: string;
  section: string;
  displayName: string;
  teacherId?: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ClassSchema = new Schema<IClass>(
  {
    schoolId: { type: String, default: DEFAULT_SCHOOL_ID, index: true },
    name: { type: String, trim: true, index: true },
    className: { type: String, trim: true, index: true },
    level: { type: String, default: '', trim: true },
    section: { type: String, default: '', trim: true },
    displayName: { type: String, default: '', trim: true },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null,
      index: true
    },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

ClassSchema.pre('validate', function syncClassNames() {
  if (!this.name && this.className) this.name = this.className;
  if (!this.className && this.name) this.className = this.name;
  if (!this.displayName) this.displayName = [this.name || this.className, this.section].filter(Boolean).join(' ');
});

ClassSchema.index(
  { schoolId: 1, name: 1, section: 1 },
  { unique: true, partialFilterExpression: { name: { $type: 'string' } } }
);

export default mongoose.model<IClass>('Class', ClassSchema);

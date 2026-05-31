import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IClass extends Document {
  className: string;          // e.g. "Basic 1" — matches Students.class at query time
  teacherId: Types.ObjectId;  // ref: Teacher
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ClassSchema = new Schema<IClass>(
  {
    className: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
      index: true
    },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model<IClass>('Class', ClassSchema);

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFee extends Document {
  studentId: Types.ObjectId;
  termFee: number;
  amountPaid: number;
  outstanding: number;
  term: string;
  year: string;
  payments: Array<{
    amount: number;
    method: string;
    date: Date;
    recordedBy: string;
    reference: string;
  }>;
  status: 'paid' | 'partial' | 'unpaid';
  createdAt: Date;
}

const FeeSchema = new Schema({
  studentId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Student', 
    required: true 
  },
  termFee: { type: Number, required: true },
  amountPaid: { type: Number, default: 0 },
  outstanding: { type: Number, default: 0 },
  term: { type: String, default: 'Term 2' },
  year: { type: String, default: '2026' },
  payments: [{
    amount: Number,
    method: String,
    date: { type: Date, default: Date.now },
    recordedBy: String,
    reference: String
  }],
  status: { 
    type: String, 
    enum: ['paid', 'partial', 'unpaid'], 
    default: 'unpaid' 
  },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IFee>('Fee', FeeSchema);

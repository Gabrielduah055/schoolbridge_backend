import mongoose from 'mongoose';
import dns from 'node:dns/promises';
import logger from '../utils/logger';

const connectDB = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URL || process.env.MONGO_URL;

  if (!mongoUri) {
    throw new Error('MONGODB_URL or MONGO_URL must be set');
  }

  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    await mongoose.connect(mongoUri);
    logger.info('MongoDB connected');
  } catch (error) {
    logger.error({ err: error }, 'MongoDB connection error');
    process.exit(1);
  }
};

export default connectDB;

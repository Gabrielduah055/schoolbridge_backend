import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';

// Mobile hotspots often refuse SRV DNS queries.
// Force Node.js to use Google's public DNS instead.
dns.setServers(['8.8.8.8', '8.8.4.4']);
import Teacher from './models/Teacher';

const seed = async () => {
  const uri = process.env.MONGODB_URL;
  if (!uri) throw new Error('MONGODB_URL is not set in .env');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB ✅');

  await Teacher.insertMany([
    {
      fullName: 'Mrs. Akosua Mensah',
      phone: '0241234567',
      email: 'akosua@school.com',
      role: 'teacher',
      active: true
    },
    {
      fullName: 'Mr. Kweku Darko',
      phone: '0551234567',
      email: 'kweku@school.com',
      role: 'teacher',
      active: true
    }
  ]);

  console.log('Teachers seeded ✅');
  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed failed ❌', err);
  process.exit(1);
});

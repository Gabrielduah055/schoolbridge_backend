import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import dns from 'node:dns/promises';
import connectDB from './config/db';
import knowledgeRoutes from './routes/knowledge';
import chatRoutes from './routes/chat';
import studentRoutes from './routes/students';

dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

connectDB();

app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/students', studentRoutes);

app.get('/', (req, res) => {
  res.json({ 
    message: 'SchoolBridge API is running 🏫🚀' 
  });
});

app.listen(PORT, () => {
  console.log(`SchoolBridge running on port ${PORT}`);
});
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import Knowledge from '../models/Knowledge';

const router = Router();
const uploadDir = './uploads/';
const allowedCategories = [
  'fee_structure',
  'student_records',
  'school_calendar',
  'school_policies',
  'exam_timetable',
  'class_timetable',
  'teacher_directory',
  'other'
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'application/csv'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('File type not supported. Use PDF, Excel, Word, CSV or TXT.'));
  }
});

const cleanupFile = (filePath?: string) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

const extractText = async (filePath: string, mimetype: string): Promise<string> => {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls' || mimetype.includes('excel') || mimetype.includes('spreadsheet')) {
    const workbook = XLSX.readFile(filePath);
    let content = '';

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet);
      content += `\n[Sheet: ${sheetName}]\n${JSON.stringify(jsonData, null, 2)}\n`;
    });

    return content.trim();
  }

  if (ext === '.csv' || mimetype.includes('csv')) {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(sheet);
    return JSON.stringify(jsonData, null, 2);
  }

  if (ext === '.pdf' || mimetype.includes('pdf')) {
    const { PDFParse } = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: dataBuffer });

    try {
      const pdfData = await parser.getText();
      return pdfData.text;
    } finally {
      await parser.destroy();
    }
  }

  if (ext === '.docx' || mimetype.includes('wordprocessingml')) {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === '.txt' || mimetype.includes('text/plain')) {
    return fs.readFileSync(filePath, 'utf-8');
  }

  throw new Error('File uploaded but format is not supported for text extraction.');
};

// Upload and train document
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { category } = req.body;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    if (!category || !allowedCategories.includes(category)) {
      cleanupFile(file.path);
      res.status(400).json({ error: 'A valid document category is required' });
      return;
    }

    const content = await extractText(file.path, file.mimetype);

    if (!content || content.trim().length < 10) {
      cleanupFile(file.path);
      res.status(400).json({
        error: 'Could not extract enough text from this file. Please check the file format.'
      });
      return;
    }

    await Knowledge.updateMany({ category }, { isActive: false });

    const knowledge = new Knowledge({
      category,
      fileName: file.originalname,
      content,
      fileSize: `${(file.size / 1024).toFixed(0)}KB`,
      isActive: true,
      uploadedAt: new Date()
    });

    await knowledge.save();
    cleanupFile(file.path);

    console.log(`Knowledge uploaded: ${category} - ${file.originalname}`);

    res.json({
      message: 'Document uploaded and bot trained successfully!',
      knowledge: {
        id: knowledge._id,
        category: knowledge.category,
        fileName: knowledge.fileName,
        fileSize: knowledge.fileSize,
        isActive: knowledge.isActive,
        uploadedAt: knowledge.uploadedAt
      }
    });
  } catch (error: any) {
    cleanupFile(req.file?.path);
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// Get all knowledge documents
router.get('/', async (req: Request, res: Response) => {
  try {
    const knowledge = await Knowledge.find()
      .select('-content')
      .sort({ uploadedAt: -1 });
    res.json(knowledge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch knowledge documents' });
  }
});

// Delete knowledge document
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const knowledge = await Knowledge.findByIdAndDelete(req.params.id);
    if (!knowledge) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Toggle active status
router.put('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const knowledge = await Knowledge.findById(req.params.id);
    if (!knowledge) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    knowledge.isActive = !knowledge.isActive;
    await knowledge.save();

    res.json({
      message: `Document ${knowledge.isActive ? 'activated' : 'deactivated'}`,
      isActive: knowledge.isActive
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle document' });
  }
});

export default router;

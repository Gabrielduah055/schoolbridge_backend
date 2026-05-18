import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import Knowledge from '../models/Knowledge';

const router = Router();

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({ storage });

// Upload and train document
router.post('/upload', upload.single('file'), 
  async (req: Request, res: Response) => {
  try {
    const { category } = req.body;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    let content = '';
    const ext = path.extname(file.originalname).toLowerCase();

    // Extract text based on file type
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);
      content = JSON.stringify(data, null, 2);

    } else if (ext === '.txt') {
      content = fs.readFileSync(file.path, 'utf-8');

    } else if (ext === '.csv') {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);
      content = JSON.stringify(data, null, 2);

    } else {
      content = fs.readFileSync(file.path, 'utf-8');
    }

    // Deactivate old document in same category
    await Knowledge.updateMany(
      { category },
      { isActive: false }
    );

    // Save new knowledge
    const knowledge = new Knowledge({
      category,
      fileName: file.originalname,
      content,
      fileSize: `${(file.size / 1024).toFixed(0)}KB`,
      isActive: true,
    });

    await knowledge.save();

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    console.log(`✅ Knowledge uploaded: ${category}`);

    res.json({ 
      message: 'Document uploaded and bot trained successfully!',
      knowledge 
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Get all knowledge documents
router.get('/', async (req: Request, res: Response) => {
  try {
    const knowledge = await Knowledge.find()
      .sort({ uploadedAt: -1 });
    res.json(knowledge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch knowledge' });
  }
});

// Delete knowledge document
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await Knowledge.findByIdAndDelete(req.params.id);
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Toggle active status
router.put('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const knowledge = await Knowledge.findById(req.params.id);
    if (!knowledge) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    knowledge.isActive = !knowledge.isActive;
    await knowledge.save();
    res.json(knowledge);
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle' });
  }
});

export default router;

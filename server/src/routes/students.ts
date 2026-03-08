import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../lib/prisma';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { importStudents } from '../services/import.service';
import { normalizePhone } from '../utils/phone';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authMiddleware, adminOnly);

// List students with optional search
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const classNameFilter = req.query.className as string | undefined;
    const where: any = {};
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { idNumber: { contains: search } },
      ];
    }
    if (classNameFilter) {
      where.className = classNameFilter;
    }

    const students = await prisma.student.findMany({
      where,
      orderBy: [{ className: 'asc' }, { lastName: 'asc' }],
    });
    res.json(students);
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Get single student
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: parseInt(req.params.id as string) },
    });
    if (!student) {
      res.status(404).json({ error: 'תלמיד לא נמצא' });
      return;
    }
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Create student
router.post('/', async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, idNumber, parent1Name, parent1Phone, parent2Name, parent2Phone, className } = req.body;
    if (!firstName || !lastName || !idNumber || !parent1Name || !parent1Phone || !className) {
      res.status(400).json({ error: 'שדות חובה חסרים' });
      return;
    }

    const student = await prisma.student.create({
      data: {
        firstName,
        lastName,
        idNumber,
        parent1Name,
        parent1Phone: normalizePhone(String(parent1Phone)),
        parent2Name,
        parent2Phone: parent2Phone ? normalizePhone(String(parent2Phone)) : null,
        className,
      },
    });
    res.status(201).json(student);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'תעודת זהות כבר קיימת במערכת' });
      return;
    }
    console.error('Create student error:', error);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Update student
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, idNumber, parent1Name, parent1Phone, parent2Name, parent2Phone, className } = req.body;
    const data: any = {};
    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;
    if (idNumber) data.idNumber = idNumber;
    if (parent1Name) data.parent1Name = parent1Name;
    if (parent1Phone) data.parent1Phone = normalizePhone(String(parent1Phone));
    if (parent2Name !== undefined) data.parent2Name = parent2Name;
    if (parent2Phone !== undefined) data.parent2Phone = parent2Phone ? normalizePhone(String(parent2Phone)) : null;
    if (className) data.className = className;

    const student = await prisma.student.update({
      where: { id: parseInt(req.params.id as string) },
      data,
    });
    res.json(student);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'תעודת זהות כבר קיימת במערכת' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'תלמיד לא נמצא' });
      return;
    }
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Delete student
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.student.delete({ where: { id: parseInt(req.params.id as string) } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'תלמיד לא נמצא' });
      return;
    }
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Download import template
router.get('/import-template', (_req: Request, res: Response) => {
  const data = [
    {
      'שם פרטי': 'ישראל',
      'שם משפחה': 'ישראלי',
      'ת.ז': '123456789',
      'כיתה': 'ב',
      'שם הורה 1': 'אברהם ישראלי',
      'טלפון הורה 1': '050-1234567',
      'שם הורה 2': 'שרה ישראלי',
      'טלפון הורה 2': '050-7654321',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  // Set RTL and column widths
  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 6 },
    { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'תלמידים');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="students_template.xlsx"');
  res.send(Buffer.from(buf));
});

// Import students from Excel/CSV
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'קובץ לא נמצא' });
      return;
    }
    const result = await importStudents(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'שגיאה בייבוא הקובץ' });
  }
});

export default router;

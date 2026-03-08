import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../lib/prisma';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { normalizePhone } from '../utils/phone';

const upload = multer({ storage: multer.memoryStorage() });

const ROLE_MAP: Record<string, string> = {
  'מחנך': 'CLASS_TEACHER', 'מחנכת': 'CLASS_TEACHER', 'מחנך/ת': 'CLASS_TEACHER',
  'מזכירות': 'SECRETARY', 'מזכירה': 'SECRETARY',
  'מורה מקצועי': 'PROFESSIONAL', 'מורה מקצועית': 'PROFESSIONAL', 'מורה': 'PROFESSIONAL',
  'שומר': 'GUARD',
  'מנהל': 'PRINCIPAL', 'מנהלת': 'PRINCIPAL', 'מנהל/ת': 'PRINCIPAL',
};

const router = Router();

router.use(authMiddleware, adminOnly);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const teachers = await prisma.teacher.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json(teachers);
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: parseInt(req.params.id as string) },
    });
    if (!teacher) {
      res.status(404).json({ error: 'מורה לא נמצא' });
      return;
    }
    res.json(teacher);
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, phone, role, className } = req.body;
    if (!name || !phone || !role) {
      res.status(400).json({ error: 'שדות חובה חסרים' });
      return;
    }

    const teacher = await prisma.teacher.create({
      data: {
        name,
        phone: normalizePhone(String(phone)),
        role,
        className,
      },
    });
    res.status(201).json(teacher);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'מספר טלפון כבר קיים במערכת' });
      return;
    }
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, phone, role, className } = req.body;
    const data: any = {};
    if (name) data.name = name;
    if (phone) data.phone = normalizePhone(String(phone));
    if (role) data.role = role;
    if (className !== undefined) data.className = className;

    const teacher = await prisma.teacher.update({
      where: { id: parseInt(req.params.id as string) },
      data,
    });
    res.json(teacher);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'מספר טלפון כבר קיים במערכת' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'מורה לא נמצא' });
      return;
    }
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Download import template
router.get('/import-template', (_req: Request, res: Response) => {
  const data = [
    { 'שם': 'חנה כהן', 'טלפון': '050-1234567', 'תפקיד': 'מחנך/ת', 'כיתה': 'ב' },
    { 'שם': 'דוד לוי', 'טלפון': '050-7654321', 'תפקיד': 'מזכירות', 'כיתה': '' },
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 6 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'מורים');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="teachers_template.xlsx"');
  res.send(Buffer.from(buf));
});

// Import teachers from Excel/CSV
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'קובץ לא נמצא' });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

    const result = { imported: 0, skipped: 0, errors: [] as string[] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row['שם'] || row['name'] || '').trim();
      const phone = String(row['טלפון'] || row['phone'] || '').trim();
      const roleRaw = String(row['תפקיד'] || row['role'] || '').trim();
      const className = String(row['כיתה'] || row['className'] || '').trim();

      if (!name || !phone || !roleRaw) {
        result.errors.push(`שורה ${i + 2}: שדות חובה חסרים`);
        result.skipped++;
        continue;
      }

      const role = ROLE_MAP[roleRaw] || roleRaw;
      if (!['CLASS_TEACHER', 'SECRETARY', 'PROFESSIONAL', 'GUARD', 'PRINCIPAL'].includes(role)) {
        result.errors.push(`שורה ${i + 2}: תפקיד לא תקין "${roleRaw}"`);
        result.skipped++;
        continue;
      }

      try {
        const normalized = normalizePhone(phone);
        const typedRole = role as any;
        await prisma.teacher.upsert({
          where: { phone: normalized },
          update: { name, role: typedRole, className: className || null },
          create: { name, phone: normalized, role: typedRole, className: className || null },
        });
        result.imported++;
      } catch (error: any) {
        result.errors.push(`שורה ${i + 2}: ${error.message}`);
        result.skipped++;
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Teacher import error:', error);
    res.status(500).json({ error: 'שגיאה בייבוא הקובץ' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.teacher.delete({ where: { id: parseInt(req.params.id as string) } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'מורה לא נמצא' });
      return;
    }
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

export default router;

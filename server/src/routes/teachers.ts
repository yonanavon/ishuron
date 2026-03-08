import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { normalizePhone } from '../utils/phone';

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

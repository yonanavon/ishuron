import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, guardOrAdmin } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, guardOrAdmin);

// Get today's approved exits for guard dashboard
router.get('/today', async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const exits = await prisma.exitRequest.findMany({
      where: {
        status: 'APPROVED',
        exitDate: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        student: true,
        teacher: true,
      },
      orderBy: { exitTime: 'asc' },
    });
    res.json(exits);
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// Get all exit requests (admin)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, from, to, page = '1', limit = '50' } = req.query;
    const where: any = {};

    if (status) where.status = status as string;
    if (from || to) {
      where.exitDate = {};
      if (from) where.exitDate.gte = new Date(from as string);
      if (to) where.exitDate.lte = new Date(to as string);
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [exits, total] = await Promise.all([
      prisma.exitRequest.findMany({
        where,
        include: { student: true, teacher: true, escalatedTo: true },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.exitRequest.count({ where }),
    ]);

    res.json({ exits, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

export default router;

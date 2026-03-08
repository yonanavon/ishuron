import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, adminOnly } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, adminOnly);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { direction, phone, from, to, page = '1', limit = '50' } = req.query;
    const where: any = {};

    if (direction) where.direction = direction as string;
    if (phone) where.phone = { contains: phone as string };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from as string);
      if (to) where.createdAt.lte = new Date(to as string);
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [logs, total] = await Promise.all([
      prisma.messageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.messageLog.count({ where }),
    ]);

    res.json({ logs, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

export default router;

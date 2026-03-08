import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, adminOnly } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, adminOnly);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.messageTemplate.findMany({
      orderBy: { key: 'asc' },
    });
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { body: templateBody, name } = req.body;
    const data: any = {};
    if (templateBody) data.body = String(templateBody);
    if (name) data.name = String(name);

    const template = await prisma.messageTemplate.update({
      where: { id: parseInt(req.params.id as string) },
      data,
    });
    res.json(template);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'תבנית לא נמצאה' });
      return;
    }
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

export default router;

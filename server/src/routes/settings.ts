import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'route:settings' });
const router = Router();

router.use(authMiddleware, adminOnly);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.setting.findMany();
    const result: Record<string, string> = {};
    for (const s of settings) {
      result[s.key] = s.value;
    }
    res.json(result);
  } catch (error) {
    log.error({ err: error }, 'get settings error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    if (req.schoolId == null) {
      res.status(400).json({ error: 'בית ספר לא מזוהה' });
      return;
    }
    const schoolId = req.schoolId;
    const updates = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(updates)) {
      await prisma.setting.upsert({
        where: { schoolId_key: { schoolId, key } },
        update: { value: String(value) },
        create: { schoolId, key, value: String(value) },
      });
    }
    res.json({ success: true });
  } catch (error) {
    log.error({ err: error }, 'update settings error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

export default router;

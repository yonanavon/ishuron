import { Router, Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { getWhatsAppService } from '../services/whatsapp.service';

const router = Router();

router.use(authMiddleware, adminOnly);

router.get('/status', (_req: Request, res: Response) => {
  const wa = getWhatsAppService();
  res.json({ status: wa.getStatus() });
});

router.get('/qr', (_req: Request, res: Response) => {
  const wa = getWhatsAppService();
  const qr = wa.getQR();
  if (qr) {
    res.json({ qr });
  } else {
    res.json({ qr: null, status: wa.getStatus() });
  }
});

router.post('/restart', async (_req: Request, res: Response) => {
  try {
    const wa = getWhatsAppService();
    await wa.restart();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'שגיאה בהפעלה מחדש' });
  }
});

export default router;

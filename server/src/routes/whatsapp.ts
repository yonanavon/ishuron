import { Router, Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { getWhatsAppService } from '../services/whatsapp.service';
import { phoneToJid } from '../utils/phone';
import { logMessage } from '../services/notification.service';

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
    res.json({ success: true, status: wa.getStatus() });
  } catch (error) {
    console.error('WhatsApp restart error:', error);
    res.status(500).json({ error: 'שגיאה בהפעלה מחדש' });
  }
});

router.post('/logout', async (_req: Request, res: Response) => {
  try {
    const wa = getWhatsAppService();
    await wa.logout();
    res.json({ success: true });
  } catch (error) {
    console.error('WhatsApp logout error:', error);
    res.status(500).json({ error: 'שגיאה בניתוק' });
  }
});

router.post('/send-test', async (req: Request, res: Response) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      res.status(400).json({ error: 'נדרש מספר טלפון והודעה' });
      return;
    }
    const wa = getWhatsAppService();
    const jid = phoneToJid(phone);
    await wa.sendMessage(jid, message);
    await logMessage('OUT', phone, message, 'test');
    res.json({ success: true });
  } catch (error: any) {
    console.error('WhatsApp send test error:', error);
    res.status(500).json({ error: error.message || 'שגיאה בשליחת הודעה' });
  }
});

router.get('/last-received', (_req: Request, res: Response) => {
  const wa = getWhatsAppService();
  const last = wa.getLastReceivedMessage();
  res.json(last);
});

export default router;

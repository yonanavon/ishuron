import { Router, Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { getWhatsAppRegistry } from '../services/whatsapp-registry';
import { normalizePhone } from '../utils/phone';
import { logMessage } from '../services/notification.service';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'route:whatsapp' });
const router = Router();

router.use(authMiddleware, adminOnly);

function waForReq(req: Request) {
  if (req.schoolId == null) return null;
  return getWhatsAppRegistry().get(req.schoolId);
}

router.get('/status', (req: Request, res: Response) => {
  const wa = waForReq(req);
  if (!wa) {
    res.status(400).json({ error: 'בית ספר לא מזוהה' });
    return;
  }
  res.json({ status: wa.getStatus() });
});

router.get('/qr', (req: Request, res: Response) => {
  const wa = waForReq(req);
  if (!wa) {
    res.status(400).json({ error: 'בית ספר לא מזוהה' });
    return;
  }
  const qr = wa.getQR();
  if (qr) {
    res.json({ qr });
  } else {
    res.json({ qr: null, status: wa.getStatus() });
  }
});

router.post('/restart', async (req: Request, res: Response) => {
  try {
    const wa = waForReq(req);
    if (!wa) {
      res.status(400).json({ error: 'בית ספר לא מזוהה' });
      return;
    }
    await wa.restart();
    res.json({ success: true, status: wa.getStatus() });
  } catch (error) {
    log.error({ err: error }, 'whatsapp restart error');
    res.status(500).json({ error: 'שגיאה בהפעלה מחדש' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  try {
    const wa = waForReq(req);
    if (!wa) {
      res.status(400).json({ error: 'בית ספר לא מזוהה' });
      return;
    }
    await wa.logout();
    res.json({ success: true });
  } catch (error) {
    log.error({ err: error }, 'whatsapp logout error');
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
    const wa = waForReq(req);
    if (!wa) {
      res.status(400).json({ error: 'בית ספר לא מזוהה' });
      return;
    }
    const normalized = normalizePhone(phone);
    const jid = wa.resolveJidForSend(normalized);
    await wa.sendMessage(jid, message);
    await logMessage('OUT', normalized, message, 'test');
    res.json({ success: true });
  } catch (error: any) {
    log.error({ err: error }, 'whatsapp send test error');
    res.status(500).json({ error: error.message || 'שגיאה בשליחת הודעה' });
  }
});

router.get('/last-received', (req: Request, res: Response) => {
  const wa = waForReq(req);
  if (!wa) {
    res.status(400).json({ error: 'בית ספר לא מזוהה' });
    return;
  }
  res.json(wa.getLastReceivedMessage());
});

export default router;

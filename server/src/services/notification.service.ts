import { prisma } from '../lib/prisma';
import { getWhatsAppService } from './whatsapp.service';
import { renderTemplate } from './template.service';
import { getIO } from '../socket';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'notify' });

export async function notifyTeacher(
  teacherPhone: string,
  vars: Record<string, string>
): Promise<void> {
  const message = await renderTemplate('teacher_approval_request', vars);
  const wa = getWhatsAppService();

  const jid = wa.resolveJidForSend(teacherPhone);
  log.debug({ teacherPhone, jid }, 'notifyTeacher');
  try {
    await wa.sendInteractiveButtons(jid, message, [
      { buttonId: 'approve', buttonText: { displayText: '✅ אישור' } },
      { buttonId: 'reject', buttonText: { displayText: '❌ דחייה' } },
    ]);
    log.debug({ jid, mode: 'buttons' }, 'notifyTeacher success');
  } catch (btnErr) {
    log.warn({ err: btnErr }, 'buttons failed, falling back to text');
    try {
      await wa.sendMessage(jid, message);
      log.debug({ jid, mode: 'text' }, 'notifyTeacher success');
    } catch (txtErr) {
      log.error({ err: txtErr, jid }, 'notifyTeacher failed');
      throw txtErr;
    }
  }

  await logMessage('OUT', teacherPhone, message, 'teacher_approval');
}

export async function notifyParent(
  parentPhone: string,
  templateKey: string,
  vars: Record<string, string>
): Promise<void> {
  const message = await renderTemplate(templateKey, vars);
  const wa = getWhatsAppService();
  await wa.sendMessage(wa.resolveJidForSend(parentPhone), message);
  await logMessage('OUT', parentPhone, message, templateKey);
}

export async function notifyGuard(vars: Record<string, string>): Promise<void> {
  const message = await renderTemplate('guard_notification', vars);

  // Send to all guards via WhatsApp
  const guards = await prisma.teacher.findMany({ where: { role: 'GUARD' } });
  const wa = getWhatsAppService();

  for (const guard of guards) {
    try {
      await wa.sendMessage(wa.resolveJidForSend(guard.phone), message);
      await logMessage('OUT', guard.phone, message, 'guard_notification');
    } catch (error) {
      log.error({ err: error, guardPhone: guard.phone }, 'failed to notify guard');
    }
  }

  // Also push via WebSocket to guard dashboard
  const io = getIO();
  if (io) {
    io.emit('exit:approved', vars);
  }
}

async function logMessage(
  direction: 'IN' | 'OUT',
  phone: string,
  content: string,
  relatedTo?: string
): Promise<void> {
  try {
    await prisma.messageLog.create({
      data: { direction, phone, content, relatedTo },
    });
  } catch (error) {
    log.error({ err: error }, 'failed to log message');
  }
}

export { logMessage };

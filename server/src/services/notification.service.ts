import { prisma } from '../lib/prisma';
import { getWhatsAppRegistry } from './whatsapp-registry';
import { renderTemplate } from './template.service';
import { emitToSchool } from '../socket';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'notify' });

export async function notifyTeacher(
  schoolId: number,
  teacherPhone: string,
  vars: Record<string, string>,
): Promise<void> {
  const message = await renderTemplate(schoolId, 'teacher_approval_request', vars);
  const wa = getWhatsAppRegistry().get(schoolId);

  const jid = wa.resolveJidForSend(teacherPhone);
  log.debug({ schoolId, teacherPhone, jid }, 'notifyTeacher');
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
  schoolId: number,
  parentPhone: string,
  templateKey: string,
  vars: Record<string, string>,
): Promise<void> {
  const message = await renderTemplate(schoolId, templateKey, vars);
  const wa = getWhatsAppRegistry().get(schoolId);
  await wa.sendMessage(wa.resolveJidForSend(parentPhone), message);
  await logMessage('OUT', parentPhone, message, templateKey);
}

export async function notifyGuard(
  schoolId: number,
  vars: Record<string, string>,
): Promise<void> {
  const message = await renderTemplate(schoolId, 'guard_notification', vars);

  const guards = await prisma.teacher.findMany({ where: { role: 'GUARD' } });
  const wa = getWhatsAppRegistry().get(schoolId);

  for (const guard of guards) {
    try {
      await wa.sendMessage(wa.resolveJidForSend(guard.phone), message);
      await logMessage('OUT', guard.phone, message, 'guard_notification');
    } catch (error) {
      log.error({ err: error, guardPhone: guard.phone }, 'failed to notify guard');
    }
  }

  emitToSchool(schoolId, 'exit:approved', vars);
}

async function logMessage(
  direction: 'IN' | 'OUT',
  phone: string,
  content: string,
  relatedTo?: string,
): Promise<void> {
  try {
    await prisma.messageLog.create({
      data: { direction, phone, content, relatedTo } as any,
    });
  } catch (error) {
    log.error({ err: error }, 'failed to log message');
  }
}

export { logMessage };

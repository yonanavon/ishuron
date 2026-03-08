import { prisma } from '../lib/prisma';
import { getWhatsAppService } from './whatsapp.service';
import { renderTemplate } from './template.service';
import { phoneToJid } from '../utils/phone';
import { getIO } from '../socket';

export async function notifyTeacher(
  teacherPhone: string,
  vars: Record<string, string>
): Promise<void> {
  const message = await renderTemplate('teacher_approval_request', vars);
  const wa = getWhatsAppService();

  // Try sending interactive buttons first, fallback to text
  try {
    await wa.sendInteractiveButtons(phoneToJid(teacherPhone), message, [
      { buttonId: 'approve', buttonText: { displayText: '✅ אישור' } },
      { buttonId: 'reject', buttonText: { displayText: '❌ דחייה' } },
    ]);
  } catch {
    await wa.sendMessage(phoneToJid(teacherPhone), message);
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
  await wa.sendMessage(phoneToJid(parentPhone), message);
  await logMessage('OUT', parentPhone, message, templateKey);
}

export async function notifyGuard(vars: Record<string, string>): Promise<void> {
  const message = await renderTemplate('guard_notification', vars);

  // Send to all guards via WhatsApp
  const guards = await prisma.teacher.findMany({ where: { role: 'GUARD' } });
  const wa = getWhatsAppService();

  for (const guard of guards) {
    try {
      await wa.sendMessage(phoneToJid(guard.phone), message);
      await logMessage('OUT', guard.phone, message, 'guard_notification');
    } catch (error) {
      console.error(`Failed to notify guard ${guard.phone}:`, error);
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
    console.error('Failed to log message:', error);
  }
}

export { logMessage };

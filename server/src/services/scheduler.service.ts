import { prisma } from '../lib/prisma';
import { notifyTeacher } from './notification.service';
import { getWhatsAppService } from './whatsapp.service';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'scheduler' });

async function getSetting(key: string, defaultValue: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return defaultValue;
  const val = parseInt(row.value);
  return isNaN(val) || val <= 0 ? defaultValue : val;
}

/**
 * Check for pending exit requests that need a reminder or escalation.
 * Exported for tests; invoked by the interval timer in production.
 */
export async function checkPendingRequests(): Promise<void> {
  const wa = getWhatsAppService();
  if (wa.getStatus() !== 'connected') return;

  const reminderMinutes = await getSetting('teacher_reminder_minutes', 15);
  const escalateMinutes = await getSetting('teacher_auto_escalate_minutes', 30);

  const now = new Date();

  // Find pending requests where teacher was notified
  const pendingRequests = await prisma.exitRequest.findMany({
    where: {
      status: 'PENDING',
      notifiedAt: { not: null },
    },
    include: {
      student: true,
      teacher: true,
    },
  });

  for (const req of pendingRequests) {
    if (!req.notifiedAt || !req.teacher) continue;

    const elapsed = (now.getTime() - req.notifiedAt.getTime()) / 1000 / 60;

    // Auto-escalate
    if (elapsed >= escalateMinutes) {
      // Atomic claim: only one worker succeeds for this request.
      const claim = await prisma.exitRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: {
          status: 'ESCALATED',
          notifiedAt: new Date(),
        },
      });
      if (claim.count === 0) continue;

      log.info({ requestId: req.id, elapsedMin: Math.round(elapsed) }, 'auto-escalating request');

      const escalateTo = await prisma.teacher.findFirst({
        where: { role: { in: ['SECRETARY', 'PRINCIPAL'] } },
      });

      if (escalateTo) {
        await prisma.exitRequest.update({
          where: { id: req.id },
          data: { escalatedToId: escalateTo.id },
        });

        const studentName = `${req.student.firstName} ${req.student.lastName}`;
        await notifyTeacher(escalateTo.phone, {
          teacherName: escalateTo.name,
          studentName,
          className: req.student.className,
          exitDate: req.exitDate.toLocaleDateString('he-IL'),
          exitTime: req.exitTime,
          parentName: '',
        });

        log.info({ requestId: req.id, escalatedTo: escalateTo.name }, 'request escalated');
      }
      continue;
    }

    // Send reminder
    if (elapsed >= reminderMinutes && !req.reminderSentAt) {
      // Atomic claim: mark reminderSentAt before sending to prevent duplicates.
      const claim = await prisma.exitRequest.updateMany({
        where: { id: req.id, status: 'PENDING', reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      if (claim.count === 0) continue;

      log.info({ requestId: req.id, elapsedMin: Math.round(elapsed) }, 'sending reminder');

      const studentName = `${req.student.firstName} ${req.student.lastName}`;
      const jid = wa.resolveJidForSend(req.teacher.phone);
      try {
        await wa.sendMessage(jid,
          `תזכורת: בקשת יציאה עבור ${studentName} (${req.student.className}) ממתינה לאישורך.\nאנא השב 1 לאישור או 2 לדחייה.`
        );
        log.info({ requestId: req.id, teacher: req.teacher.name }, 'reminder sent');
      } catch (err) {
        log.error({ err, requestId: req.id }, 'failed to send reminder');
      }
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (intervalId) return;
  // Check every 2 minutes
  intervalId = setInterval(() => {
    checkPendingRequests().catch(err => log.error({ err }, 'scheduler tick error'));
  }, 2 * 60 * 1000);
  log.info('scheduler started (every 2 minutes)');
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    log.info('scheduler stopped');
  }
}

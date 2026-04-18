import { prisma, runWithTenant } from '../lib/prisma';
import { notifyTeacher } from './notification.service';
import { getWhatsAppRegistry } from './whatsapp-registry';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'scheduler' });

async function getSetting(schoolId: number, key: string, defaultValue: number): Promise<number> {
  const row = await runWithTenant({ schoolId }, () =>
    prisma.setting.findUnique({ where: { schoolId_key: { schoolId, key } } }),
  );
  if (!row) return defaultValue;
  const val = parseInt(row.value);
  return isNaN(val) || val <= 0 ? defaultValue : val;
}

async function checkSchool(schoolId: number): Promise<void> {
  const registry = getWhatsAppRegistry();
  const wa = registry.get(schoolId);
  if (wa.getStatus() !== 'connected') return;

  const reminderMinutes = await getSetting(schoolId, 'teacher_reminder_minutes', 15);
  const escalateMinutes = await getSetting(schoolId, 'teacher_auto_escalate_minutes', 30);

  const now = new Date();

  await runWithTenant({ schoolId }, async () => {
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

      if (elapsed >= escalateMinutes) {
        const claim = await prisma.exitRequest.updateMany({
          where: { id: req.id, status: 'PENDING' },
          data: {
            status: 'ESCALATED',
            notifiedAt: new Date(),
          },
        });
        if (claim.count === 0) continue;

        log.info({ schoolId, requestId: req.id, elapsedMin: Math.round(elapsed) }, 'auto-escalating');

        const escalateTo = await prisma.teacher.findFirst({
          where: { role: { in: ['SECRETARY', 'PRINCIPAL'] } },
        });

        if (escalateTo) {
          await prisma.exitRequest.update({
            where: { id: req.id },
            data: { escalatedToId: escalateTo.id },
          });

          const studentName = `${req.student.firstName} ${req.student.lastName}`;
          await notifyTeacher(schoolId, escalateTo.phone, {
            teacherName: escalateTo.name,
            studentName,
            className: req.student.className,
            exitDate: req.exitDate.toLocaleDateString('he-IL'),
            exitTime: req.exitTime,
            parentName: '',
          });

          log.info({ schoolId, requestId: req.id, escalatedTo: escalateTo.name }, 'request escalated');
        }
        continue;
      }

      if (elapsed >= reminderMinutes && !req.reminderSentAt) {
        const claim = await prisma.exitRequest.updateMany({
          where: { id: req.id, status: 'PENDING', reminderSentAt: null },
          data: { reminderSentAt: new Date() },
        });
        if (claim.count === 0) continue;

        log.info({ schoolId, requestId: req.id, elapsedMin: Math.round(elapsed) }, 'sending reminder');

        const studentName = `${req.student.firstName} ${req.student.lastName}`;
        const jid = wa.resolveJidForSend(req.teacher.phone);
        try {
          await wa.sendMessage(
            jid,
            `תזכורת: בקשת יציאה עבור ${studentName} (${req.student.className}) ממתינה לאישורך.\nאנא השב 1 לאישור או 2 לדחייה.`,
          );
          log.info({ schoolId, requestId: req.id, teacher: req.teacher.name }, 'reminder sent');
        } catch (err) {
          log.error({ err, schoolId, requestId: req.id }, 'failed to send reminder');
        }
      }
    }
  });
}

/**
 * Run one scheduler tick across every active school.
 * Exported for tests; invoked by the interval timer in production.
 */
export async function checkPendingRequests(): Promise<void> {
  const schools = await runWithTenant({ schoolId: null, bypass: true }, () =>
    prisma.school.findMany({ where: { isActive: true }, select: { id: true } }),
  );
  for (const s of schools) {
    try {
      await checkSchool(s.id);
    } catch (err) {
      log.error({ err, schoolId: s.id }, 'scheduler tick error for school');
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (intervalId) return;
  intervalId = setInterval(() => {
    checkPendingRequests().catch((err) => log.error({ err }, 'scheduler tick error'));
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

import { prisma } from '../lib/prisma';
import { notifyTeacher } from './notification.service';
import { getWhatsAppService } from './whatsapp.service';

async function getSetting(key: string, defaultValue: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return defaultValue;
  const val = parseInt(row.value);
  return isNaN(val) || val <= 0 ? defaultValue : val;
}

/**
 * Check for pending exit requests that need a reminder or escalation.
 */
async function checkPendingRequests(): Promise<void> {
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
      console.log(`[Scheduler] Auto-escalating request #${req.id} (${elapsed.toFixed(0)} min elapsed)`);

      // Find secretary or principal to escalate to
      const escalateTo = await prisma.teacher.findFirst({
        where: { role: { in: ['SECRETARY', 'PRINCIPAL'] } },
      });

      if (escalateTo) {
        await prisma.exitRequest.update({
          where: { id: req.id },
          data: {
            status: 'ESCALATED',
            escalatedToId: escalateTo.id,
            notifiedAt: new Date(),
          },
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

        console.log(`[Scheduler] Escalated request #${req.id} to ${escalateTo.name}`);
      }
      continue;
    }

    // Send reminder
    if (elapsed >= reminderMinutes && !req.reminderSentAt) {
      console.log(`[Scheduler] Sending reminder for request #${req.id} (${elapsed.toFixed(0)} min elapsed)`);

      const studentName = `${req.student.firstName} ${req.student.lastName}`;
      const jid = wa.resolveJidForSend(req.teacher.phone);
      try {
        await wa.sendMessage(jid,
          `תזכורת: בקשת יציאה עבור ${studentName} (${req.student.className}) ממתינה לאישורך.\nאנא השב 1 לאישור או 2 לדחייה.`
        );
        await prisma.exitRequest.update({
          where: { id: req.id },
          data: { reminderSentAt: new Date() },
        });
        console.log(`[Scheduler] Reminder sent for request #${req.id} to ${req.teacher.name}`);
      } catch (err) {
        console.error(`[Scheduler] Failed to send reminder for request #${req.id}:`, err);
      }
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (intervalId) return;
  // Check every 2 minutes
  intervalId = setInterval(() => {
    checkPendingRequests().catch(err =>
      console.error('[Scheduler] Error:', err)
    );
  }, 2 * 60 * 1000);
  console.log('[Scheduler] Started — checking every 2 minutes');
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Scheduler] Stopped');
  }
}

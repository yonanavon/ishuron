import { prisma } from '../lib/prisma';
import { normalizePhone } from '../utils/phone';
import {
  parseMessage,
  matchStudentName,
  parseTeacherResponse,
  parseTeacherPickedResponse,
  parseEscalationChoice,
} from './message-parser.service';
import { renderTemplate } from './template.service';
import { notifyTeacher, notifyParent, notifyGuard, logMessage } from './notification.service';
import { getWhatsAppRegistry } from './whatsapp-registry';
import { ConversationState, Prisma } from '@prisma/client';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'bot' });

interface ConversationContext {
  studentIds?: number[];
  selectedStudentIds?: number[];
  studentId?: number;
  studentName?: string;
  exitDate?: string;
  exitTime?: string;
  exitRequestId?: number;
  exitRequestIds?: number[];
  parentName?: string;
  className?: string;
}

async function sendMessage(schoolId: number, phone: string, text: string): Promise<void> {
  const wa = getWhatsAppRegistry().get(schoolId);
  const jid = wa.resolveJidForSend(phone);
  log.debug({ schoolId, phone, jid, preview: text.substring(0, 50) }, 'sendMessage');
  try {
    await wa.sendMessage(jid, text);
    log.debug({ jid }, 'sendMessage success');
  } catch (err) {
    log.error({ err, jid }, 'sendMessage failed');
    throw err;
  }
  await logMessage('OUT', phone, text);
}

export async function handleIncomingMessage(
  schoolId: number,
  phone: string,
  text: string,
  _senderJid?: string,
): Promise<void> {
  const normalizedPhone = normalizePhone(phone);
  log.debug({ schoolId, phone, normalizedPhone }, 'handleIncomingMessage');

  const teacher = await prisma.teacher.findUnique({
    where: { schoolId_phone: { schoolId, phone: normalizedPhone } },
  });
  if (teacher) {
    log.debug({ teacher: teacher.name }, 'recognized as teacher');
    await handleTeacherMessage(schoolId, normalizedPhone, text, teacher);
    return;
  }

  let conversation = await prisma.conversation.findUnique({
    where: { schoolId_phone: { schoolId, phone: normalizedPhone } },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { schoolId, phone: normalizedPhone, state: 'IDLE' },
    });
  }

  if (conversation.expiresAt && new Date() > conversation.expiresAt) {
    await resetConversation(schoolId, normalizedPhone);
    conversation = await prisma.conversation.findUnique({
      where: { schoolId_phone: { schoolId, phone: normalizedPhone } },
    });
    if (!conversation) return;
  }

  switch (conversation.state) {
    case 'IDLE':
      await handleIdleState(schoolId, normalizedPhone, text);
      break;
    case 'AWAITING_STUDENT_SELECTION':
      await handleStudentSelection(
        schoolId,
        normalizedPhone,
        text,
        conversation.contextData as ConversationContext,
      );
      break;
    case 'AWAITING_DATETIME':
      await handleDateTimeInput(
        schoolId,
        normalizedPhone,
        text,
        conversation.contextData as ConversationContext,
      );
      break;
    case 'AWAITING_TEACHER_RESPONSE':
      await handleParentFollowUp(
        schoolId,
        normalizedPhone,
        text,
        conversation.contextData as ConversationContext,
      );
      break;
    default:
      await resetConversation(schoolId, normalizedPhone);
  }
}

async function handleIdleState(schoolId: number, phone: string, text: string): Promise<void> {
  const students = await prisma.student.findMany({
    where: {
      OR: [{ parent1Phone: phone }, { parent2Phone: phone }],
    },
  });

  if (students.length === 0) {
    log.info({ phone }, 'no students found for phone, sending parent_not_found');
    const msg = await renderTemplate(schoolId, 'parent_not_found');
    await sendMessage(schoolId, phone, msg);
    return;
  }
  log.debug(
    { phone, count: students.length, names: students.map((s) => s.firstName) },
    'found students for phone',
  );

  const firstStudent = students[0];
  const parentName =
    firstStudent.parent1Phone === phone
      ? firstStudent.parent1Name
      : firstStudent.parent2Name || firstStudent.parent1Name;

  const parsed = parseMessage(text);
  let matchedStudents = parsed.name ? matchStudentName(parsed.name, students) : [];

  if (students.length === 1) {
    const student = students[0];
    const studentName = `${student.firstName} ${student.lastName}`;

    if (parsed.date && parsed.time) {
      await createExitRequest(
        schoolId,
        phone,
        student.id,
        studentName,
        parsed.date,
        parsed.time,
        parentName,
        student.className,
      );
      return;
    }

    const msg = `שלום ${parentName}, להוציא את ${student.firstName}?\nאנא שלח תאריך ושעה.\nלדוגמה: "היום 12:00" או "מחר 10:30"`;
    await updateConversation(schoolId, phone, 'AWAITING_DATETIME', {
      studentId: student.id,
      studentName,
      parentName,
      className: student.className,
      exitDate: parsed.date?.toISOString(),
      exitTime: parsed.time,
    });
    await sendMessage(schoolId, phone, msg);
    return;
  }

  if (matchedStudents.length === 0) {
    const list = students
      .map((s, i) => `${i + 1}. ${s.firstName} ${s.lastName} (${s.className})`)
      .join('\n');
    const msg = `שלום ${parentName}, איזה ילד/ה תרצה להוציא?\n${list}\nשלח מספר מהרשימה (לכמה ילדים: 1,2)`;
    await updateConversation(schoolId, phone, 'AWAITING_STUDENT_SELECTION', {
      studentIds: students.map((s) => s.id),
      parentName,
    });
    await sendMessage(schoolId, phone, msg);
    return;
  }

  if (matchedStudents.length > 1 && matchedStudents[0].score < 0.8) {
    const list = matchedStudents
      .slice(0, 5)
      .map(
        (s, i) =>
          `${i + 1}. ${s.firstName} ${s.lastName} (${students.find((st) => st.id === s.id)?.className})`,
      )
      .join('\n');
    const msg = `שלום ${parentName}, למי התכוונת?\n${list}\nשלח מספר מהרשימה.`;
    await updateConversation(schoolId, phone, 'AWAITING_STUDENT_SELECTION', {
      studentIds: matchedStudents.slice(0, 5).map((s) => s.id),
      parentName,
    });
    await sendMessage(schoolId, phone, msg);
    return;
  }

  const student = matchedStudents[0];
  const studentName = `${student.firstName} ${student.lastName}`;

  if (!parsed.date || !parsed.time) {
    const msg = await renderTemplate(schoolId, 'datetime_request', { studentName });
    await updateConversation(schoolId, phone, 'AWAITING_DATETIME', {
      studentId: student.id,
      studentName,
      parentName,
      className: students.find((s) => s.id === student.id)?.className,
      exitDate: parsed.date?.toISOString(),
      exitTime: parsed.time,
    });
    await sendMessage(schoolId, phone, msg);
    return;
  }

  await createExitRequest(
    schoolId,
    phone,
    student.id,
    studentName,
    parsed.date,
    parsed.time,
    parentName,
    students.find((s) => s.id === student.id)?.className || '',
  );
}

async function handleStudentSelection(
  schoolId: number,
  phone: string,
  text: string,
  context: ConversationContext,
): Promise<void> {
  if (!context.studentIds) {
    await sendMessage(schoolId, phone, 'אנא שלח מספר תקין מהרשימה.');
    return;
  }

  const indices = parseMultipleSelections(text, context.studentIds.length);

  if (indices.length === 0) {
    await sendMessage(
      schoolId,
      phone,
      'אנא שלח מספר תקין מהרשימה. לבחירת כמה ילדים שלח למשל: 1,2',
    );
    return;
  }

  const selectedStudents = [];
  for (const idx of indices) {
    const studentId = context.studentIds[idx];
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (student) selectedStudents.push(student);
  }

  if (selectedStudents.length === 0) {
    await sendMessage(schoolId, phone, 'תלמיד לא נמצא. אנא נסה שנית.');
    await resetConversation(schoolId, phone);
    return;
  }

  if (selectedStudents.length === 1) {
    const student = selectedStudents[0];
    const studentName = `${student.firstName} ${student.lastName}`;
    const msg = await renderTemplate(schoolId, 'datetime_request', { studentName });
    await updateConversation(schoolId, phone, 'AWAITING_DATETIME', {
      ...context,
      studentId: student.id,
      studentName,
      className: student.className,
    });
    await sendMessage(schoolId, phone, msg);
  } else {
    const names = selectedStudents.map((s) => `${s.firstName} ${s.lastName}`).join(' ו');
    const msg = await renderTemplate(schoolId, 'datetime_request', { studentName: names });
    await updateConversation(schoolId, phone, 'AWAITING_DATETIME', {
      ...context,
      selectedStudentIds: selectedStudents.map((s) => s.id),
      studentName: names,
    });
    await sendMessage(schoolId, phone, msg);
  }
}

function parseMultipleSelections(text: string, maxCount: number): number[] {
  const cleaned = text.trim();
  const parts = cleaned.split(/[\s,+]+|ו-?/).filter(Boolean);
  const indices: number[] = [];
  for (const part of parts) {
    const num = parseInt(part);
    if (!isNaN(num) && num >= 1 && num <= maxCount) {
      const idx = num - 1;
      if (!indices.includes(idx)) indices.push(idx);
    }
  }
  return indices;
}

async function handleDateTimeInput(
  schoolId: number,
  phone: string,
  text: string,
  context: ConversationContext,
): Promise<void> {
  const parsed = parseMessage(text);
  const exitDate = parsed.date || (context.exitDate ? new Date(context.exitDate) : undefined);
  const exitTime = parsed.time || context.exitTime;

  if (!exitDate || !exitTime) {
    await sendMessage(
      schoolId,
      phone,
      'לא הצלחתי לזהות תאריך ושעה. אנא שלח בפורמט: "היום 12:00" או "מחר 10:30" או "15/3 14:00"',
    );
    return;
  }

  if (context.selectedStudentIds && context.selectedStudentIds.length > 1) {
    const exitRequestIds: number[] = [];
    const names: string[] = [];
    for (const studentId of context.selectedStudentIds) {
      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) continue;
      const studentName = `${student.firstName} ${student.lastName}`;
      names.push(studentName);
      const requestId = await createExitRequestSilent(
        schoolId,
        phone,
        studentId,
        studentName,
        exitDate,
        exitTime,
        context.parentName || '',
        student.className,
      );
      if (requestId) exitRequestIds.push(requestId);
    }

    await updateConversation(schoolId, phone, 'AWAITING_TEACHER_RESPONSE', {
      ...context,
      exitRequestIds,
      studentName: names.join(' ו'),
      exitDate: exitDate.toISOString(),
      exitTime,
    });

    const allNames = names.join(' ו');
    await sendMessage(
      schoolId,
      phone,
      `בקשות היציאה עבור ${allNames} נשלחו למורים. אנא המתן לאישור.`,
    );
    return;
  }

  await createExitRequest(
    schoolId,
    phone,
    context.studentId!,
    context.studentName!,
    exitDate,
    exitTime,
    context.parentName || '',
    context.className || '',
  );
}

async function handleParentFollowUp(
  schoolId: number,
  phone: string,
  text: string,
  context: ConversationContext,
): Promise<void> {
  const choice = parseEscalationChoice(text);

  if (choice === 'secretary' || choice === 'principal') {
    const targetRole = choice === 'secretary' ? 'SECRETARY' : 'PRINCIPAL';
    const escalateTo = await prisma.teacher.findFirst({ where: { role: targetRole } });

    if (!escalateTo) {
      await sendMessage(
        schoolId,
        phone,
        `לא נמצא ${choice === 'secretary' ? 'מזכירות' : 'מנהל'} במערכת.`,
      );
      return;
    }

    const requestIds =
      context.exitRequestIds || (context.exitRequestId ? [context.exitRequestId] : []);
    for (const reqId of requestIds) {
      await prisma.exitRequest
        .update({
          where: { id: reqId },
          data: { status: 'ESCALATED', escalatedToId: escalateTo.id },
        })
        .catch(() => {});
    }

    const exitRequest =
      requestIds.length > 0
        ? await prisma.exitRequest.findUnique({
            where: { id: requestIds[0] },
            include: { student: true },
          })
        : null;

    if (exitRequest) {
      await notifyTeacher(schoolId, escalateTo.phone, {
        teacherName: escalateTo.name,
        studentName: context.studentName || '',
        className: context.className || '',
        exitDate: exitRequest.exitDate.toLocaleDateString('he-IL'),
        exitTime: exitRequest.exitTime,
        parentName: context.parentName || '',
      });
    }

    const msg = await renderTemplate(schoolId, 'escalated', {
      studentName: context.studentName || '',
      escalatedToName: escalateTo.name,
    });
    await sendMessage(schoolId, phone, msg);
    return;
  }

  if (choice === 'wait') {
    const msg = await renderTemplate(schoolId, 'teacher_pending', {
      studentName: context.studentName || '',
      teacherName: '',
    });
    await sendMessage(schoolId, phone, msg);
    return;
  }

  const students = await prisma.student.findMany({
    where: {
      OR: [{ parent1Phone: phone }, { parent2Phone: phone }],
    },
  });

  if (students.length > 1) {
    const parsed = parseMessage(text);
    const matchedStudents = parsed.name ? matchStudentName(parsed.name, students) : [];

    if (matchedStudents.length > 0 && matchedStudents[0].score >= 0.5) {
      log.info(
        { studentName: matchedStudents[0].firstName },
        'parent follow-up recognized as new request',
      );
      await handleIdleState(schoolId, phone, text);
      return;
    }
  }

  const msg = await renderTemplate(schoolId, 'teacher_pending', {
    studentName: context.studentName || '',
    teacherName: '',
  });
  await sendMessage(schoolId, phone, msg);
}

async function handleTeacherMessage(
  schoolId: number,
  phone: string,
  text: string,
  teacher: { id: number; name: string },
): Promise<void> {
  const pendingRequests = await prisma.exitRequest.findMany({
    where: {
      OR: [
        { teacherId: teacher.id, status: 'PENDING' },
        { escalatedToId: teacher.id, status: 'ESCALATED' },
      ],
    },
    include: { student: true },
    orderBy: { createdAt: 'asc' },
  });

  if (pendingRequests.length === 0) {
    await sendMessage(schoolId, phone, 'לא נמצאה בקשה ממתינה.');
    return;
  }

  let exitRequest = pendingRequests[0];
  let response = parseTeacherResponse(text);

  if (pendingRequests.length > 1) {
    const picked = parseTeacherPickedResponse(text, pendingRequests.length);
    if (!picked) {
      const list = pendingRequests
        .map(
          (r, i) =>
            `${i + 1}. ${r.student.firstName} ${r.student.lastName} (${r.student.className}) ${r.exitDate.toLocaleDateString('he-IL')} ${r.exitTime}`,
        )
        .join('\n');
      await sendMessage(
        schoolId,
        phone,
        `יש ${pendingRequests.length} בקשות ממתינות:\n${list}\nהשב בפורמט: <מספר בקשה> <1 לאישור / 2 לדחייה>. לדוגמה: "2 1"`,
      );
      return;
    }
    exitRequest = pendingRequests[picked.index];
    response = picked.action;
  } else if (!response) {
    await sendMessage(schoolId, phone, 'אנא השב 1 לאישור או 2 לדחייה.');
    return;
  }

  const studentName = `${exitRequest.student.firstName} ${exitRequest.student.lastName}`;
  const vars = {
    studentName,
    teacherName: teacher.name,
    className: exitRequest.student.className,
    exitDate: exitRequest.exitDate.toLocaleDateString('he-IL'),
    exitTime: exitRequest.exitTime,
  };

  if (response === 'approve') {
    await prisma.exitRequest.update({
      where: { id: exitRequest.id },
      data: { status: 'APPROVED' },
    });

    await notifyParent(schoolId, exitRequest.requestedBy, 'request_approved', vars);
    await notifyGuard(schoolId, vars);

    await sendMessage(schoolId, phone, `✅ אישרת את יציאת ${studentName}.`);
  } else {
    await prisma.exitRequest.update({
      where: { id: exitRequest.id },
      data: { status: 'REJECTED' },
    });

    await notifyParent(schoolId, exitRequest.requestedBy, 'request_rejected', vars);

    await sendMessage(schoolId, phone, `❌ דחית את יציאת ${studentName}.`);
  }

  const remainingPending = await prisma.exitRequest.count({
    where: {
      requestedBy: exitRequest.requestedBy,
      status: { in: ['PENDING', 'ESCALATED'] },
    },
  });
  if (remainingPending === 0) {
    await resetConversation(schoolId, exitRequest.requestedBy);
  }
}

async function createExitRequest(
  schoolId: number,
  phone: string,
  studentId: number,
  studentName: string,
  exitDate: Date,
  exitTime: string,
  parentName: string,
  className: string,
): Promise<void> {
  const requestId = await createExitRequestSilent(
    schoolId,
    phone,
    studentId,
    studentName,
    exitDate,
    exitTime,
    parentName,
    className,
  );

  const classTeacher = await prisma.teacher.findFirst({
    where: { className, role: 'CLASS_TEACHER' },
  });

  const msg = await renderTemplate(schoolId, 'request_sent_to_teacher', {
    studentName,
    teacherName: classTeacher?.name || 'המורה',
  });

  await updateConversation(schoolId, phone, 'AWAITING_TEACHER_RESPONSE', {
    studentId,
    studentName,
    exitRequestId: requestId || undefined,
    parentName,
    className,
  });

  await sendMessage(schoolId, phone, msg);
}

async function createExitRequestSilent(
  schoolId: number,
  phone: string,
  studentId: number,
  studentName: string,
  exitDate: Date,
  exitTime: string,
  parentName: string,
  className: string,
): Promise<number | null> {
  const classTeacher = await prisma.teacher.findFirst({
    where: { className, role: 'CLASS_TEACHER' },
  });
  log.info(
    { schoolId, className, classTeacher: classTeacher?.name, teacherPhone: classTeacher?.phone },
    'createExitRequest',
  );

  const exitRequest = await prisma.exitRequest.create({
    data: {
      studentId,
      requestedBy: phone,
      exitDate,
      exitTime,
      status: 'PENDING',
      teacherId: classTeacher?.id,
    } as any,
  });

  if (classTeacher) {
    await notifyTeacher(schoolId, classTeacher.phone, {
      teacherName: classTeacher.name,
      studentName,
      className,
      exitDate: exitDate.toLocaleDateString('he-IL'),
      exitTime,
      parentName,
    });
    await prisma.exitRequest.update({
      where: { id: exitRequest.id },
      data: { notifiedAt: new Date() },
    });
  }

  return exitRequest.id;
}

async function updateConversation(
  schoolId: number,
  phone: string,
  state: ConversationState,
  contextData: ConversationContext,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const data = contextData as unknown as Prisma.InputJsonValue;
  await prisma.conversation.upsert({
    where: { schoolId_phone: { schoolId, phone } },
    update: { state, contextData: data, expiresAt },
    create: { schoolId, phone, state, contextData: data, expiresAt },
  });
}

async function resetConversation(schoolId: number, phone: string): Promise<void> {
  await prisma.conversation.upsert({
    where: { schoolId_phone: { schoolId, phone } },
    update: { state: 'IDLE', contextData: Prisma.JsonNull, expiresAt: null },
    create: { schoolId, phone, state: 'IDLE' },
  });
}

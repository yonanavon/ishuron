import { prisma } from '../lib/prisma';
import { normalizePhone } from '../utils/phone';
import { parseMessage, matchStudentName, parseTeacherResponse, parseEscalationChoice } from './message-parser.service';
import { renderTemplate } from './template.service';
import { notifyTeacher, notifyParent, notifyGuard, logMessage } from './notification.service';
import { getWhatsAppService } from './whatsapp.service';
import { phoneToJid } from '../utils/phone';
import { ConversationState } from '@prisma/client';

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

async function sendMessage(phone: string, text: string): Promise<void> {
  const wa = getWhatsAppService();
  const jid = wa.resolveJidForSend(phone);
  console.log(`[Bot] sendMessage phone="${phone}" jid="${jid}" text="${text.substring(0, 50)}..."`);
  try {
    await wa.sendMessage(jid, text);
    console.log(`[Bot] sendMessage SUCCESS to ${jid}`);
  } catch (err) {
    console.error(`[Bot] sendMessage FAILED to ${jid}:`, err);
    throw err;
  }
  await logMessage('OUT', phone, text);
}

export async function handleIncomingMessage(phone: string, text: string, _senderJid?: string): Promise<void> {
  const normalizedPhone = normalizePhone(phone);
  console.log(`[Bot] handleIncomingMessage phone="${phone}" normalized="${normalizedPhone}"`);

  // Check if this is a teacher responding
  const teacher = await prisma.teacher.findUnique({ where: { phone: normalizedPhone } });
  if (teacher) {
    console.log(`[Bot] Recognized as teacher: ${teacher.name}`);
    await handleTeacherMessage(normalizedPhone, text, teacher);
    return;
  }

  // Get or create conversation
  let conversation = await prisma.conversation.findUnique({
    where: { phone: normalizedPhone },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { phone: normalizedPhone, state: 'IDLE' },
    });
  }

  // Check if conversation expired
  if (conversation.expiresAt && new Date() > conversation.expiresAt) {
    await resetConversation(normalizedPhone);
    conversation = await prisma.conversation.findUnique({ where: { phone: normalizedPhone } })!;
    if (!conversation) return;
  }

  switch (conversation.state) {
    case 'IDLE':
      await handleIdleState(normalizedPhone, text);
      break;
    case 'AWAITING_STUDENT_SELECTION':
      await handleStudentSelection(normalizedPhone, text, conversation.contextData as ConversationContext);
      break;
    case 'AWAITING_DATETIME':
      await handleDateTimeInput(normalizedPhone, text, conversation.contextData as ConversationContext);
      break;
    case 'AWAITING_TEACHER_RESPONSE':
      await handleParentFollowUp(normalizedPhone, text, conversation.contextData as ConversationContext);
      break;
    default:
      await resetConversation(normalizedPhone);
  }
}

async function handleIdleState(phone: string, text: string): Promise<void> {
  // Find students by parent phone
  const students = await prisma.student.findMany({
    where: {
      OR: [
        { parent1Phone: phone },
        { parent2Phone: phone },
      ],
    },
  });

  if (students.length === 0) {
    console.log(`[Bot] No students found for phone="${phone}". Sending parent_not_found.`);
    const msg = await renderTemplate('parent_not_found');
    await sendMessage(phone, msg);
    return;
  }
  console.log(`[Bot] Found ${students.length} student(s) for phone="${phone}": ${students.map(s => `${s.firstName} (p1=${s.parent1Phone}, p2=${s.parent2Phone})`).join(', ')}`);

  // Find parent name
  const firstStudent = students[0];
  const parentName = firstStudent.parent1Phone === phone
    ? firstStudent.parent1Name
    : (firstStudent.parent2Name || firstStudent.parent1Name);

  // Parse the message
  const parsed = parseMessage(text);

  // Try to match student name
  let matchedStudents = parsed.name
    ? matchStudentName(parsed.name, students)
    : [];

  if (students.length === 1) {
    // Only one child — skip name matching, go straight to datetime
    const student = students[0];
    const studentName = `${student.firstName} ${student.lastName}`;

    if (parsed.date && parsed.time) {
      // All info available — create request immediately
      await createExitRequest(phone, student.id, studentName, parsed.date, parsed.time, parentName, student.className);
      return;
    }

    // Greet parent and ask for datetime directly
    const msg = `שלום ${parentName}, להוציא את ${student.firstName}?\nאנא שלח תאריך ושעה.\nלדוגמה: "היום 12:00" או "מחר 10:30"`;
    await updateConversation(phone, 'AWAITING_DATETIME', {
      studentId: student.id,
      studentName,
      parentName,
      className: student.className,
      exitDate: parsed.date?.toISOString(),
      exitTime: parsed.time,
    });
    await sendMessage(phone, msg);
    return;
  }

  // Multiple children
  if (matchedStudents.length === 0) {
    // Couldn't determine which child
    const list = students.map((s, i) => `${i + 1}. ${s.firstName} ${s.lastName} (${s.className})`).join('\n');
    const msg = `שלום ${parentName}, איזה ילד/ה תרצה להוציא?\n${list}\nשלח מספר מהרשימה (לכמה ילדים: 1,2)`;
    await updateConversation(phone, 'AWAITING_STUDENT_SELECTION', {
      studentIds: students.map(s => s.id),
      parentName,
    });
    await sendMessage(phone, msg);
    return;
  }

  if (matchedStudents.length > 1 && matchedStudents[0].score < 0.8) {
    // Ambiguous match
    const list = matchedStudents.slice(0, 5).map((s, i) =>
      `${i + 1}. ${s.firstName} ${s.lastName} (${students.find(st => st.id === s.id)?.className})`
    ).join('\n');
    const msg = `שלום ${parentName}, למי התכוונת?\n${list}\nשלח מספר מהרשימה.`;
    await updateConversation(phone, 'AWAITING_STUDENT_SELECTION', {
      studentIds: matchedStudents.slice(0, 5).map(s => s.id),
      parentName,
    });
    await sendMessage(phone, msg);
    return;
  }

  const student = matchedStudents[0];
  const studentName = `${student.firstName} ${student.lastName}`;

  // Check if we have date and time
  if (!parsed.date || !parsed.time) {
    const msg = await renderTemplate('datetime_request', { studentName });
    await updateConversation(phone, 'AWAITING_DATETIME', {
      studentId: student.id,
      studentName,
      parentName,
      className: students.find(s => s.id === student.id)?.className,
      exitDate: parsed.date?.toISOString(),
      exitTime: parsed.time,
    });
    await sendMessage(phone, msg);
    return;
  }

  // All info available - create request
  await createExitRequest(phone, student.id, studentName, parsed.date, parsed.time, parentName,
    students.find(s => s.id === student.id)?.className || '');
}

async function handleStudentSelection(phone: string, text: string, context: ConversationContext): Promise<void> {
  if (!context.studentIds) {
    await sendMessage(phone, 'אנא שלח מספר תקין מהרשימה.');
    return;
  }

  // Parse multiple selections: "1 2", "1,2", "1+2", "1 ו2", "1 ו-2"
  const indices = parseMultipleSelections(text, context.studentIds.length);

  if (indices.length === 0) {
    await sendMessage(phone, 'אנא שלח מספר תקין מהרשימה. לבחירת כמה ילדים שלח למשל: 1,2');
    return;
  }

  // Load selected students
  const selectedStudents = [];
  for (const idx of indices) {
    const studentId = context.studentIds[idx];
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (student) selectedStudents.push(student);
  }

  if (selectedStudents.length === 0) {
    await sendMessage(phone, 'תלמיד לא נמצא. אנא נסה שנית.');
    await resetConversation(phone);
    return;
  }

  if (selectedStudents.length === 1) {
    // Single selection — ask for datetime
    const student = selectedStudents[0];
    const studentName = `${student.firstName} ${student.lastName}`;
    const msg = await renderTemplate('datetime_request', { studentName });
    await updateConversation(phone, 'AWAITING_DATETIME', {
      ...context,
      studentId: student.id,
      studentName,
      className: student.className,
    });
    await sendMessage(phone, msg);
  } else {
    // Multiple selection — ask for datetime for all
    const names = selectedStudents.map(s => `${s.firstName} ${s.lastName}`).join(' ו');
    const msg = await renderTemplate('datetime_request', { studentName: names });
    await updateConversation(phone, 'AWAITING_DATETIME', {
      ...context,
      selectedStudentIds: selectedStudents.map(s => s.id),
      studentName: names,
    });
    await sendMessage(phone, msg);
  }
}

function parseMultipleSelections(text: string, maxCount: number): number[] {
  const cleaned = text.trim();
  // Split by comma, space, plus, "ו", "ו-"
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

async function handleDateTimeInput(phone: string, text: string, context: ConversationContext): Promise<void> {
  const parsed = parseMessage(text);
  const exitDate = parsed.date || (context.exitDate ? new Date(context.exitDate) : undefined);
  const exitTime = parsed.time || context.exitTime;

  if (!exitDate || !exitTime) {
    await sendMessage(phone, 'לא הצלחתי לזהות תאריך ושעה. אנא שלח בפורמט: "היום 12:00" או "מחר 10:30" או "15/3 14:00"');
    return;
  }

  // Multiple students selected
  if (context.selectedStudentIds && context.selectedStudentIds.length > 1) {
    const exitRequestIds: number[] = [];
    const names: string[] = [];
    for (const studentId of context.selectedStudentIds) {
      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) continue;
      const studentName = `${student.firstName} ${student.lastName}`;
      names.push(studentName);
      const requestId = await createExitRequestSilent(
        phone, studentId, studentName, exitDate, exitTime,
        context.parentName || '', student.className
      );
      if (requestId) exitRequestIds.push(requestId);
    }

    await updateConversation(phone, 'AWAITING_TEACHER_RESPONSE', {
      ...context,
      exitRequestIds,
      studentName: names.join(' ו'),
      exitDate: exitDate.toISOString(),
      exitTime,
    });

    const allNames = names.join(' ו');
    await sendMessage(phone, `בקשות היציאה עבור ${allNames} נשלחו למורים. אנא המתן לאישור.`);
    return;
  }

  // Single student
  await createExitRequest(
    phone,
    context.studentId!,
    context.studentName!,
    exitDate,
    exitTime,
    context.parentName || '',
    context.className || ''
  );
}

async function handleParentFollowUp(phone: string, text: string, context: ConversationContext): Promise<void> {
  const choice = parseEscalationChoice(text);

  if (choice === 'secretary' || choice === 'principal') {
    const targetRole = choice === 'secretary' ? 'SECRETARY' : 'PRINCIPAL';
    const escalateTo = await prisma.teacher.findFirst({ where: { role: targetRole } });

    if (!escalateTo) {
      await sendMessage(phone, `לא נמצא ${choice === 'secretary' ? 'מזכירות' : 'מנהל'} במערכת.`);
      return;
    }

    // Escalate all active exit requests
    const requestIds = context.exitRequestIds || (context.exitRequestId ? [context.exitRequestId] : []);
    for (const reqId of requestIds) {
      await prisma.exitRequest.update({
        where: { id: reqId },
        data: { status: 'ESCALATED', escalatedToId: escalateTo.id },
      }).catch(() => {});
    }

    // Notify escalation target for the first request (for context)
    const exitRequest = requestIds.length > 0
      ? await prisma.exitRequest.findUnique({
          where: { id: requestIds[0] },
          include: { student: true },
        })
      : null;

    if (exitRequest) {
      await notifyTeacher(escalateTo.phone, {
        teacherName: escalateTo.name,
        studentName: context.studentName || '',
        className: context.className || '',
        exitDate: exitRequest.exitDate.toLocaleDateString('he-IL'),
        exitTime: exitRequest.exitTime,
        parentName: context.parentName || '',
      });
    }

    const msg = await renderTemplate('escalated', {
      studentName: context.studentName || '',
      escalatedToName: escalateTo.name,
    });
    await sendMessage(phone, msg);
    return;
  }

  if (choice === 'wait') {
    const msg = await renderTemplate('teacher_pending', {
      studentName: context.studentName || '',
      teacherName: '',
    });
    await sendMessage(phone, msg);
    return;
  }

  // Not an escalation choice — check if this is a new exit request for another child
  const students = await prisma.student.findMany({
    where: {
      OR: [
        { parent1Phone: phone },
        { parent2Phone: phone },
      ],
    },
  });

  if (students.length > 1) {
    const parsed = parseMessage(text);
    const matchedStudents = parsed.name ? matchStudentName(parsed.name, students) : [];

    if (matchedStudents.length > 0 && matchedStudents[0].score >= 0.5) {
      // This looks like a new request for another child — start fresh for this child
      console.log(`[Bot] Parent follow-up recognized as new request for "${matchedStudents[0].firstName}"`);
      await handleIdleState(phone, text);
      return;
    }
  }

  // Default — treat as "wait"
  const msg = await renderTemplate('teacher_pending', {
    studentName: context.studentName || '',
    teacherName: '',
  });
  await sendMessage(phone, msg);
}

async function handleTeacherMessage(
  phone: string,
  text: string,
  teacher: { id: number; name: string }
): Promise<void> {
  const response = parseTeacherResponse(text);
  if (!response) {
    await sendMessage(phone, 'אנא השב 1 לאישור או 2 לדחייה.');
    return;
  }

  // Find pending request for this teacher
  const exitRequest = await prisma.exitRequest.findFirst({
    where: {
      OR: [
        { teacherId: teacher.id, status: 'PENDING' },
        { escalatedToId: teacher.id, status: 'ESCALATED' },
      ],
    },
    include: { student: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!exitRequest) {
    await sendMessage(phone, 'לא נמצאה בקשה ממתינה.');
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

    // Notify parent
    await notifyParent(exitRequest.requestedBy, 'request_approved', vars);

    // Notify guard
    await notifyGuard(vars);

    await sendMessage(phone, `✅ אישרת את יציאת ${studentName}.`);
  } else {
    await prisma.exitRequest.update({
      where: { id: exitRequest.id },
      data: { status: 'REJECTED' },
    });

    await notifyParent(exitRequest.requestedBy, 'request_rejected', vars);

    await sendMessage(phone, `❌ דחית את יציאת ${studentName}.`);
  }

  // Reset parent conversation only if no more pending requests from this parent
  const remainingPending = await prisma.exitRequest.count({
    where: {
      requestedBy: exitRequest.requestedBy,
      status: { in: ['PENDING', 'ESCALATED'] },
    },
  });
  if (remainingPending === 0) {
    await resetConversation(exitRequest.requestedBy);
  }
}

/**
 * Create exit request, notify teacher, update conversation, and message parent.
 * Used for single-student flow.
 */
async function createExitRequest(
  phone: string,
  studentId: number,
  studentName: string,
  exitDate: Date,
  exitTime: string,
  parentName: string,
  className: string
): Promise<void> {
  const requestId = await createExitRequestSilent(
    phone, studentId, studentName, exitDate, exitTime, parentName, className
  );

  const classTeacher = await prisma.teacher.findFirst({
    where: { className, role: 'CLASS_TEACHER' },
  });

  const msg = await renderTemplate('request_sent_to_teacher', {
    studentName,
    teacherName: classTeacher?.name || 'המורה',
  });

  await updateConversation(phone, 'AWAITING_TEACHER_RESPONSE', {
    studentId,
    studentName,
    exitRequestId: requestId || undefined,
    parentName,
    className,
  });

  await sendMessage(phone, msg);
}

/**
 * Create exit request and notify teacher, without messaging the parent
 * or updating conversation. Returns the request ID.
 */
async function createExitRequestSilent(
  phone: string,
  studentId: number,
  studentName: string,
  exitDate: Date,
  exitTime: string,
  parentName: string,
  className: string
): Promise<number | null> {
  const classTeacher = await prisma.teacher.findFirst({
    where: { className, role: 'CLASS_TEACHER' },
  });
  console.log(`[Bot] createExitRequest className="${className}" classTeacher=${classTeacher ? `${classTeacher.name} (${classTeacher.phone})` : 'NOT FOUND'}`);

  const exitRequest = await prisma.exitRequest.create({
    data: {
      studentId,
      requestedBy: phone,
      exitDate,
      exitTime,
      status: 'PENDING',
      teacherId: classTeacher?.id,
    },
  });

  if (classTeacher) {
    await notifyTeacher(classTeacher.phone, {
      teacherName: classTeacher.name,
      studentName,
      className,
      exitDate: exitDate.toLocaleDateString('he-IL'),
      exitTime,
      parentName,
    });
  }

  return exitRequest.id;
}

async function updateConversation(
  phone: string,
  state: ConversationState,
  contextData: ConversationContext
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await prisma.conversation.upsert({
    where: { phone },
    update: { state, contextData: contextData as any, expiresAt },
    create: { phone, state, contextData: contextData as any, expiresAt },
  });
}

async function resetConversation(phone: string): Promise<void> {
  await prisma.conversation.upsert({
    where: { phone },
    update: { state: 'IDLE', contextData: undefined, expiresAt: null },
    create: { phone, state: 'IDLE' },
  });
}

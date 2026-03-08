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
  studentId?: number;
  studentName?: string;
  exitDate?: string;
  exitTime?: string;
  exitRequestId?: number;
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
    // Only one child - use directly
    matchedStudents = [{ ...students[0], score: 1 }];
  }

  if (matchedStudents.length === 0 && students.length > 1) {
    // Multiple children, couldn't determine which one
    const list = students.map((s, i) => `${i + 1}. ${s.firstName} ${s.lastName} (${s.className})`).join('\n');
    const msg = await renderTemplate('student_selection', { studentList: list });
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
    const msg = await renderTemplate('student_selection', { studentList: list });
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
  const index = parseInt(text.trim()) - 1;
  if (isNaN(index) || !context.studentIds || index < 0 || index >= context.studentIds.length) {
    await sendMessage(phone, 'אנא שלח מספר תקין מהרשימה.');
    return;
  }

  const studentId = context.studentIds[index];
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) {
    await sendMessage(phone, 'תלמיד לא נמצא. אנא נסה שנית.');
    await resetConversation(phone);
    return;
  }

  const studentName = `${student.firstName} ${student.lastName}`;
  const msg = await renderTemplate('datetime_request', { studentName });
  await updateConversation(phone, 'AWAITING_DATETIME', {
    ...context,
    studentId,
    studentName,
    className: student.className,
  });
  await sendMessage(phone, msg);
}

async function handleDateTimeInput(phone: string, text: string, context: ConversationContext): Promise<void> {
  const parsed = parseMessage(text);
  const exitDate = parsed.date || (context.exitDate ? new Date(context.exitDate) : undefined);
  const exitTime = parsed.time || context.exitTime;

  if (!exitDate || !exitTime) {
    await sendMessage(phone, 'לא הצלחתי לזהות תאריך ושעה. אנא שלח בפורמט: "היום 12:00" או "מחר 10:30" או "15/3 14:00"');
    return;
  }

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

  if (choice === 'wait' || choice === null) {
    const msg = await renderTemplate('teacher_pending', {
      studentName: context.studentName || '',
      teacherName: '', // Will be filled from exit request
    });
    await sendMessage(phone, msg);
    return;
  }

  if (choice === 'secretary' || choice === 'principal') {
    const targetRole = choice === 'secretary' ? 'SECRETARY' : 'PRINCIPAL';
    const escalateTo = await prisma.teacher.findFirst({ where: { role: targetRole } });

    if (!escalateTo) {
      await sendMessage(phone, `לא נמצא ${choice === 'secretary' ? 'מזכירות' : 'מנהל'} במערכת.`);
      return;
    }

    // Update exit request
    if (context.exitRequestId) {
      await prisma.exitRequest.update({
        where: { id: context.exitRequestId },
        data: { status: 'ESCALATED', escalatedToId: escalateTo.id },
      });
    }

    // Notify escalation target
    const exitRequest = context.exitRequestId
      ? await prisma.exitRequest.findUnique({
          where: { id: context.exitRequestId },
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
  }
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

    // Update conversation
    await resetConversation(exitRequest.requestedBy);

    await sendMessage(phone, `✅ אישרת את יציאת ${studentName}.`);
  } else {
    await prisma.exitRequest.update({
      where: { id: exitRequest.id },
      data: { status: 'REJECTED' },
    });

    await notifyParent(exitRequest.requestedBy, 'request_rejected', vars);
    await resetConversation(exitRequest.requestedBy);

    await sendMessage(phone, `❌ דחית את יציאת ${studentName}.`);
  }
}

async function createExitRequest(
  phone: string,
  studentId: number,
  studentName: string,
  exitDate: Date,
  exitTime: string,
  parentName: string,
  className: string
): Promise<void> {
  // Find class teacher
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

  const msg = await renderTemplate('request_sent_to_teacher', {
    studentName,
    teacherName: classTeacher?.name || 'המורה',
  });

  await updateConversation(phone, 'AWAITING_TEACHER_RESPONSE', {
    studentId,
    studentName,
    exitRequestId: exitRequest.id,
    parentName,
    className,
  });

  await sendMessage(phone, msg);
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

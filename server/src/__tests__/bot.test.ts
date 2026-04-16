import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Prisma mock ----
const mockPrisma = {
  teacher: { findUnique: vi.fn(), findFirst: vi.fn() },
  student: { findMany: vi.fn(), findUnique: vi.fn() },
  conversation: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  exitRequest: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
};

// ---- WhatsApp mock ----
const sentMessages: Array<{ jid: string; text: string }> = [];
const mockWa = {
  resolveJidForSend: vi.fn((phone: string) => `${phone}@s.whatsapp.net`),
  sendMessage: vi.fn(async (jid: string, text: string) => {
    sentMessages.push({ jid, text });
  }),
  sendInteractiveButtons: vi.fn(async () => {}),
};

// ---- Notification mock ----
const mockNotifyTeacher = vi.fn(async () => {});
const mockNotifyParent = vi.fn(async () => {});
const mockNotifyGuard = vi.fn(async () => {});
const mockLogMessage = vi.fn(async () => {});

// ---- Template mock ----
// Simple stub that returns a deterministic string so we can assert.
const mockRenderTemplate = vi.fn(async (key: string, vars?: Record<string, string>) => {
  const varsStr = vars ? ` ${JSON.stringify(vars)}` : '';
  return `[tpl:${key}]${varsStr}`;
});

vi.mock('../lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('../services/whatsapp.service', () => ({
  getWhatsAppService: () => mockWa,
}));
vi.mock('../services/notification.service', () => ({
  notifyTeacher: mockNotifyTeacher,
  notifyParent: mockNotifyParent,
  notifyGuard: mockNotifyGuard,
  logMessage: mockLogMessage,
}));
vi.mock('../services/template.service', () => ({
  renderTemplate: mockRenderTemplate,
}));

const { handleIncomingMessage } = await import('../services/bot.service');

function student(overrides: Partial<any> = {}) {
  return {
    id: 1,
    firstName: 'דני',
    lastName: 'כהן',
    className: 'ד1',
    parent1Name: 'אבא',
    parent1Phone: '972501111111',
    parent2Name: null,
    parent2Phone: null,
    ...overrides,
  };
}

function teacher(overrides: Partial<any> = {}) {
  return { id: 10, name: 'רינה', phone: '972509999999', role: 'CLASS_TEACHER', className: 'ד1', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  sentMessages.length = 0;
  // Default: phone is not a teacher.
  mockPrisma.teacher.findUnique.mockResolvedValue(null);
  // Default: no existing conversation; create returns IDLE.
  mockPrisma.conversation.findUnique.mockResolvedValue(null);
  mockPrisma.conversation.create.mockImplementation(async ({ data }: any) => ({
    id: 1,
    state: data.state,
    contextData: null,
    expiresAt: null,
    phone: data.phone,
  }));
  mockPrisma.conversation.upsert.mockResolvedValue({});
  mockPrisma.exitRequest.create.mockResolvedValue({ id: 42 });
  mockPrisma.exitRequest.update.mockResolvedValue({});
  mockPrisma.exitRequest.count.mockResolvedValue(0);
});

describe('bot.handleIncomingMessage — unknown parent', () => {
  it('sends parent_not_found template when phone matches no student', async () => {
    mockPrisma.student.findMany.mockResolvedValue([]);

    await handleIncomingMessage('0501111111', 'שלום');

    expect(mockRenderTemplate).toHaveBeenCalledWith('parent_not_found');
    expect(mockWa.sendMessage).toHaveBeenCalledOnce();
  });
});

describe('bot.handleIncomingMessage — single child', () => {
  it('asks for datetime directly (no name matching) when text has only greeting', async () => {
    mockPrisma.student.findMany.mockResolvedValue([student()]);

    await handleIncomingMessage('0501111111', 'שלום');

    // Should move conversation to AWAITING_DATETIME.
    expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone: '972501111111' },
        update: expect.objectContaining({ state: 'AWAITING_DATETIME' }),
      }),
    );
    // Sent a message to the parent (datetime prompt).
    expect(mockWa.sendMessage).toHaveBeenCalledOnce();
  });

  it('creates exit request immediately when text has date + time', async () => {
    mockPrisma.student.findMany.mockResolvedValue([student()]);
    mockPrisma.teacher.findFirst.mockResolvedValue(teacher());

    await handleIncomingMessage('0501111111', 'היום 10:00');

    expect(mockPrisma.exitRequest.create).toHaveBeenCalledOnce();
    expect(mockNotifyTeacher).toHaveBeenCalledOnce();
    // Parent conversation should move to AWAITING_TEACHER_RESPONSE.
    expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ state: 'AWAITING_TEACHER_RESPONSE' }),
      }),
    );
  });
});

describe('bot.handleIncomingMessage — multiple children', () => {
  it('asks to pick a child when text does not identify one', async () => {
    mockPrisma.student.findMany.mockResolvedValue([
      student({ id: 1, firstName: 'דני' }),
      student({ id: 2, firstName: 'מיכל' }),
    ]);

    await handleIncomingMessage('0501111111', 'שלום');

    expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ state: 'AWAITING_STUDENT_SELECTION' }),
      }),
    );
    expect(mockWa.sendMessage).toHaveBeenCalledOnce();
    // Message should contain both names.
    expect(sentMessages[0].text).toContain('דני');
    expect(sentMessages[0].text).toContain('מיכל');
  });
});

describe('bot.handleIncomingMessage — teacher responding', () => {
  it('approves when teacher has exactly one pending request', async () => {
    const pending = {
      id: 42,
      status: 'PENDING',
      requestedBy: '972501111111',
      exitDate: new Date('2026-04-20'),
      exitTime: '10:00',
      student: student(),
    };
    mockPrisma.teacher.findUnique.mockResolvedValue(teacher());
    mockPrisma.exitRequest.findMany.mockResolvedValue([pending]);

    await handleIncomingMessage('0509999999', '1');

    expect(mockPrisma.exitRequest.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: 'APPROVED' },
    });
    expect(mockNotifyParent).toHaveBeenCalledWith(
      '972501111111',
      'request_approved',
      expect.any(Object),
    );
    expect(mockNotifyGuard).toHaveBeenCalledOnce();
  });

  it('rejects when teacher responds "2"', async () => {
    const pending = {
      id: 42,
      status: 'PENDING',
      requestedBy: '972501111111',
      exitDate: new Date('2026-04-20'),
      exitTime: '10:00',
      student: student(),
    };
    mockPrisma.teacher.findUnique.mockResolvedValue(teacher());
    mockPrisma.exitRequest.findMany.mockResolvedValue([pending]);

    await handleIncomingMessage('0509999999', '2');

    expect(mockPrisma.exitRequest.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: 'REJECTED' },
    });
    expect(mockNotifyParent).toHaveBeenCalledWith(
      '972501111111',
      'request_rejected',
      expect.any(Object),
    );
    expect(mockNotifyGuard).not.toHaveBeenCalled();
  });

  it('asks teacher to pick when multiple pending requests and response is just "1"', async () => {
    mockPrisma.teacher.findUnique.mockResolvedValue(teacher());
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      {
        id: 1,
        status: 'PENDING',
        requestedBy: '972501111111',
        exitDate: new Date('2026-04-20'),
        exitTime: '10:00',
        student: student({ firstName: 'דני' }),
      },
      {
        id: 2,
        status: 'PENDING',
        requestedBy: '972502222222',
        exitDate: new Date('2026-04-20'),
        exitTime: '11:00',
        student: student({ firstName: 'מיכל' }),
      },
    ]);

    await handleIncomingMessage('0509999999', '1');

    // Should NOT approve anything — should ask to disambiguate.
    expect(mockPrisma.exitRequest.update).not.toHaveBeenCalled();
    expect(mockNotifyParent).not.toHaveBeenCalled();
    expect(sentMessages[0].text).toContain('דני');
    expect(sentMessages[0].text).toContain('מיכל');
  });

  it('approves the picked request when teacher sends "<num> 1"', async () => {
    mockPrisma.teacher.findUnique.mockResolvedValue(teacher());
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      {
        id: 1,
        status: 'PENDING',
        requestedBy: '972501111111',
        exitDate: new Date('2026-04-20'),
        exitTime: '10:00',
        student: student({ firstName: 'דני' }),
      },
      {
        id: 2,
        status: 'PENDING',
        requestedBy: '972502222222',
        exitDate: new Date('2026-04-20'),
        exitTime: '11:00',
        student: student({ firstName: 'מיכל' }),
      },
    ]);

    await handleIncomingMessage('0509999999', '2 1');

    expect(mockPrisma.exitRequest.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { status: 'APPROVED' },
    });
  });

  it('replies "no pending request" when teacher has none', async () => {
    mockPrisma.teacher.findUnique.mockResolvedValue(teacher());
    mockPrisma.exitRequest.findMany.mockResolvedValue([]);

    await handleIncomingMessage('0509999999', '1');

    expect(sentMessages[0].text).toContain('לא נמצאה');
    expect(mockPrisma.exitRequest.update).not.toHaveBeenCalled();
  });
});

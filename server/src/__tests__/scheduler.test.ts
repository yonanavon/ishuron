import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks must be declared before importing the module under test.
const mockPrisma = {
  setting: { findUnique: vi.fn() },
  exitRequest: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  teacher: { findFirst: vi.fn() },
};

const mockWa = {
  getStatus: vi.fn(() => 'connected'),
  resolveJidForSend: vi.fn((phone: string) => `${phone}@s.whatsapp.net`),
  sendMessage: vi.fn(async () => {}),
};

const mockNotifyTeacher = vi.fn(async () => {});

vi.mock('../lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('../services/whatsapp.service', () => ({
  getWhatsAppService: () => mockWa,
}));
vi.mock('../services/notification.service', () => ({
  notifyTeacher: mockNotifyTeacher,
}));

const { checkPendingRequests } = await import('../services/scheduler.service');

function makeRequest(overrides: Partial<any> = {}) {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
  return {
    id: 1,
    status: 'PENDING',
    notifiedAt: minutesAgo(20),
    reminderSentAt: null,
    exitDate: new Date('2026-04-20'),
    exitTime: '10:00',
    teacher: { id: 1, name: 'רינה', phone: '972501111111' },
    student: { firstName: 'דני', lastName: 'כהן', className: 'ד1' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWa.getStatus.mockReturnValue('connected');
  mockPrisma.setting.findUnique.mockResolvedValue(null); // use defaults
  mockPrisma.exitRequest.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.teacher.findFirst.mockResolvedValue({
    id: 99,
    name: 'מזכירה',
    phone: '972502222222',
  });
});

describe('scheduler.checkPendingRequests', () => {
  it('does nothing when WhatsApp is disconnected', async () => {
    mockWa.getStatus.mockReturnValue('disconnected');
    await checkPendingRequests();
    expect(mockPrisma.exitRequest.findMany).not.toHaveBeenCalled();
  });

  it('sends a reminder once the reminder threshold has passed', async () => {
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      makeRequest({ notifiedAt: new Date(Date.now() - 16 * 60 * 1000) }),
    ]);

    await checkPendingRequests();

    expect(mockPrisma.exitRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'PENDING', reminderSentAt: null },
      data: { reminderSentAt: expect.any(Date) },
    });
    expect(mockWa.sendMessage).toHaveBeenCalledOnce();
  });

  it('skips sending when the claim returns count=0 (race condition)', async () => {
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      makeRequest({ notifiedAt: new Date(Date.now() - 16 * 60 * 1000) }),
    ]);
    // Another worker already claimed this request.
    mockPrisma.exitRequest.updateMany.mockResolvedValue({ count: 0 });

    await checkPendingRequests();

    expect(mockPrisma.exitRequest.updateMany).toHaveBeenCalledOnce();
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  it('escalates when the escalation threshold has passed', async () => {
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      makeRequest({ notifiedAt: new Date(Date.now() - 35 * 60 * 1000) }),
    ]);

    await checkPendingRequests();

    // Atomic claim for escalation.
    expect(mockPrisma.exitRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'PENDING' },
      data: expect.objectContaining({ status: 'ESCALATED' }),
    });
    expect(mockNotifyTeacher).toHaveBeenCalledOnce();
    expect(mockPrisma.exitRequest.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { escalatedToId: 99 },
    });
  });

  it('does not escalate when escalation claim fails (already claimed)', async () => {
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      makeRequest({ notifiedAt: new Date(Date.now() - 35 * 60 * 1000) }),
    ]);
    mockPrisma.exitRequest.updateMany.mockResolvedValue({ count: 0 });

    await checkPendingRequests();

    expect(mockPrisma.exitRequest.updateMany).toHaveBeenCalledOnce();
    expect(mockNotifyTeacher).not.toHaveBeenCalled();
    expect(mockPrisma.exitRequest.update).not.toHaveBeenCalled();
  });

  it('does nothing for requests below reminder threshold', async () => {
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      makeRequest({ notifiedAt: new Date(Date.now() - 5 * 60 * 1000) }),
    ]);

    await checkPendingRequests();

    expect(mockPrisma.exitRequest.updateMany).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  it('does not re-send a reminder when reminderSentAt is already set', async () => {
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      makeRequest({
        notifiedAt: new Date(Date.now() - 20 * 60 * 1000),
        reminderSentAt: new Date(Date.now() - 2 * 60 * 1000),
      }),
    ]);

    await checkPendingRequests();

    expect(mockPrisma.exitRequest.updateMany).not.toHaveBeenCalled();
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  it('respects custom thresholds from settings', async () => {
    mockPrisma.setting.findUnique.mockImplementation(({ where }: any) => {
      if (where.key === 'teacher_reminder_minutes') {
        return Promise.resolve({ key: where.key, value: '5' });
      }
      if (where.key === 'teacher_auto_escalate_minutes') {
        return Promise.resolve({ key: where.key, value: '10' });
      }
      return Promise.resolve(null);
    });
    mockPrisma.exitRequest.findMany.mockResolvedValue([
      makeRequest({ notifiedAt: new Date(Date.now() - 6 * 60 * 1000) }),
    ]);

    await checkPendingRequests();

    // 6 min > 5 min reminder, < 10 min escalate → reminder should fire.
    expect(mockWa.sendMessage).toHaveBeenCalledOnce();
    expect(mockNotifyTeacher).not.toHaveBeenCalled();
  });
});

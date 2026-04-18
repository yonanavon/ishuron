import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPrisma = {
  setting: { findUnique: vi.fn() },
  exitRequest: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  teacher: { findFirst: vi.fn() },
  school: { findMany: vi.fn() },
};

type FakeWa = {
  schoolId: number;
  getStatus: ReturnType<typeof vi.fn>;
  resolveJidForSend: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
};

const waInstances = new Map<number, FakeWa>();
function makeWa(schoolId: number): FakeWa {
  return {
    schoolId,
    getStatus: vi.fn(() => 'connected'),
    resolveJidForSend: vi.fn((phone: string) => `${phone}@s.whatsapp.net`),
    sendMessage: vi.fn(async () => {}),
  };
}

const mockNotifyTeacher = vi.fn(async () => {});

vi.mock('../lib/prisma', () => ({
  prisma: mockPrisma,
  runWithTenant: async (_ctx: any, fn: any) => fn(),
}));
vi.mock('../services/whatsapp-registry', () => ({
  getWhatsAppRegistry: () => ({
    get: (schoolId: number) => {
      let inst = waInstances.get(schoolId);
      if (!inst) {
        inst = makeWa(schoolId);
        waInstances.set(schoolId, inst);
      }
      return inst;
    },
  }),
}));
vi.mock('../services/notification.service', () => ({
  notifyTeacher: mockNotifyTeacher,
}));

const { checkPendingRequests } = await import('../services/scheduler.service');

function makeRequest(schoolId: number, overrides: Partial<any> = {}) {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
  return {
    id: schoolId * 100,
    schoolId,
    status: 'PENDING',
    notifiedAt: minutesAgo(16),
    reminderSentAt: null,
    exitDate: new Date('2026-04-20'),
    exitTime: '10:00',
    teacher: { id: schoolId, name: `teacher${schoolId}`, phone: `9725000000${schoolId}` },
    student: { firstName: 'דני', lastName: 'כהן', className: 'ד1' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  waInstances.clear();
  mockPrisma.setting.findUnique.mockResolvedValue(null);
  mockPrisma.exitRequest.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.teacher.findFirst.mockResolvedValue({
    id: 999,
    name: 'מזכירה',
    phone: '972502222222',
  });
});

describe('scheduler — multi-tenant routing', () => {
  it('iterates every active school and sends each reminder via its own WA instance', async () => {
    mockPrisma.school.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    // Each school returns a different pending request.
    mockPrisma.exitRequest.findMany.mockImplementation(async () => {
      // Simulate Prisma extension scoping: we can't read schoolId directly here,
      // but we can return the full cross-tenant dataset and trust the scheduler
      // to only have queried through its tenant scope. Since runWithTenant is a
      // pass-through in this mock, we instead alternate based on call order.
      const callIdx = mockPrisma.exitRequest.findMany.mock.calls.length;
      return [makeRequest(callIdx)];
    });

    await checkPendingRequests();

    // Two schools → two WA instances created, each received exactly one message.
    expect(waInstances.size).toBe(2);
    const wa1 = waInstances.get(1)!;
    const wa2 = waInstances.get(2)!;
    expect(wa1.sendMessage).toHaveBeenCalledOnce();
    expect(wa2.sendMessage).toHaveBeenCalledOnce();

    // School 1's message must not contain school 2's teacher phone and vice versa.
    const wa1Jid = wa1.sendMessage.mock.calls[0][0];
    const wa2Jid = wa2.sendMessage.mock.calls[0][0];
    expect(wa1Jid).toContain('97250000001');
    expect(wa2Jid).toContain('97250000002');
    expect(wa1Jid).not.toEqual(wa2Jid);
  });

  it('skips schools whose WhatsApp is disconnected without bleeding into others', async () => {
    mockPrisma.school.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    // Pre-create instance for school 1 and mark disconnected.
    const wa1 = makeWa(1);
    wa1.getStatus.mockReturnValue('disconnected');
    waInstances.set(1, wa1);

    mockPrisma.exitRequest.findMany.mockResolvedValue([makeRequest(2)]);

    await checkPendingRequests();

    // School 1 disconnected → findMany is never called for it.
    // School 2 connected → called once.
    expect(mockPrisma.exitRequest.findMany).toHaveBeenCalledOnce();
    expect(wa1.sendMessage).not.toHaveBeenCalled();

    const wa2 = waInstances.get(2)!;
    expect(wa2.sendMessage).toHaveBeenCalledOnce();
  });

  it('continues processing other schools if one throws', async () => {
    mockPrisma.school.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    let call = 0;
    mockPrisma.exitRequest.findMany.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error('db blew up for school 1');
      return [makeRequest(2)];
    });

    await expect(checkPendingRequests()).resolves.toBeUndefined();

    const wa2 = waInstances.get(2);
    expect(wa2?.sendMessage).toHaveBeenCalledOnce();
  });
});

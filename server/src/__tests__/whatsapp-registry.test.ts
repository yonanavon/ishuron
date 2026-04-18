import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock WhatsAppService to avoid opening real sockets. Each instance records its schoolId.
class FakeWhatsAppService {
  status = 'disconnected';
  connect = vi.fn(async () => {
    this.status = 'connected';
  });
  logout = vi.fn(async () => {
    this.status = 'disconnected';
  });
  getStatus = vi.fn(() => this.status);
  constructor(public readonly schoolId: number) {}
}

vi.mock('../services/whatsapp.service', () => ({
  WhatsAppService: FakeWhatsAppService,
}));

const mockPrisma = {
  school: { findMany: vi.fn() },
};

vi.mock('../lib/prisma', () => ({
  prisma: mockPrisma,
  runWithTenant: async (_ctx: any, fn: any) => fn(),
}));

const { getWhatsAppRegistry } = await import('../services/whatsapp-registry');

beforeEach(() => {
  vi.clearAllMocks();
  // The registry is a module-level singleton; reset its internal Map by
  // disconnecting every school we may have touched in prior tests.
  const reg = getWhatsAppRegistry();
  for (const [id] of reg.getAll()) {
    reg.getAll().delete(id);
  }
});

describe('WhatsAppRegistry', () => {
  it('returns the same instance for repeated get(schoolId)', () => {
    const reg = getWhatsAppRegistry();
    const a1 = reg.get(1);
    const a2 = reg.get(1);
    expect(a1).toBe(a2);
  });

  it('creates a separate instance per school', () => {
    const reg = getWhatsAppRegistry();
    const a = reg.get(1);
    const b = reg.get(2);
    expect(a).not.toBe(b);
    expect((a as any).schoolId).toBe(1);
    expect((b as any).schoolId).toBe(2);
  });

  it('getStatusIfExists returns null for schools that were never connected', () => {
    const reg = getWhatsAppRegistry();
    expect(reg.getStatusIfExists(42)).toBeNull();
    // After .get, instance exists and status should be reported.
    reg.get(42);
    expect(reg.getStatusIfExists(42)).toBe('disconnected');
  });

  it('has() reflects whether an instance was lazily created', () => {
    const reg = getWhatsAppRegistry();
    expect(reg.has(5)).toBe(false);
    reg.get(5);
    expect(reg.has(5)).toBe(true);
  });

  it('connectAll calls connect on every active school (best-effort, per-school)', async () => {
    mockPrisma.school.findMany.mockResolvedValue([
      { id: 1, slug: 'a' },
      { id: 2, slug: 'b' },
      { id: 3, slug: 'c' },
    ]);

    const reg = getWhatsAppRegistry();
    await reg.connectAll();

    // After connectAll, every school has an instance and connect was fired.
    for (const id of [1, 2, 3]) {
      const inst = reg.get(id) as unknown as FakeWhatsAppService;
      expect(inst.connect).toHaveBeenCalledOnce();
    }
  });

  it('disconnect removes the instance so next get() creates a fresh one', async () => {
    const reg = getWhatsAppRegistry();
    const first = reg.get(7);
    await reg.disconnect(7);
    expect(reg.has(7)).toBe(false);

    const second = reg.get(7);
    expect(second).not.toBe(first);
    expect((first as unknown as FakeWhatsAppService).logout).toHaveBeenCalledOnce();
  });

  it('disconnect for unknown schoolId is a safe no-op', async () => {
    const reg = getWhatsAppRegistry();
    await expect(reg.disconnect(9999)).resolves.toBeUndefined();
  });
});

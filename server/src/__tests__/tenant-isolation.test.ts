import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authMiddleware, generateToken, superAdminOnly } from '../middleware/auth';
import { runWithTenant, currentSchoolId, getTenantContext } from '../lib/prisma';
import type { Request, Response, NextFunction } from 'express';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as Request;
}

function makeRes(): Response & { _status?: number; _body?: any } {
  const res: any = {};
  res.status = vi.fn((code: number) => {
    res._status = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res._body = body;
    return res;
  });
  return res;
}

describe('auth middleware — cross-tenant guard', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('rejects an ADMIN token for school A when request is on school B subdomain', () => {
    const token = generateToken({ userId: 1, username: 'a', role: 'ADMIN', schoolId: 1 });
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
      schoolId: 2,
    } as any);
    const res = makeRes();

    authMiddleware(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an ADMIN token that has no school context on a tenant host', () => {
    const token = generateToken({ userId: 1, username: 'a', role: 'ADMIN', schoolId: 1 });
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
      // no schoolId (as if super-admin host)
    } as any);
    const res = makeRes();

    authMiddleware(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an ADMIN token matching the current school', () => {
    const token = generateToken({ userId: 1, username: 'a', role: 'ADMIN', schoolId: 5 });
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
      schoolId: 5,
    } as any);
    const res = makeRes();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });

  it('allows a SUPER_ADMIN token even on a tenant host', () => {
    const token = generateToken({
      userId: 99,
      username: 'super',
      role: 'SUPER_ADMIN',
      schoolId: null,
    });
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
      schoolId: 7, // doesn't matter — super bypasses
    } as any);
    const res = makeRes();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects requests without a token', () => {
    const req = makeReq();
    const res = makeRes();

    authMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects tampered tokens', () => {
    const req = makeReq({ headers: { authorization: 'Bearer not-a-real-jwt' } });
    const res = makeRes();

    authMiddleware(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('superAdminOnly middleware', () => {
  it('rejects a regular ADMIN', () => {
    const req = { user: { role: 'ADMIN' } } as any;
    const res = makeRes();
    const next = vi.fn();

    superAdminOnly(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a GUARD', () => {
    const req = { user: { role: 'GUARD' } } as any;
    const res = makeRes();
    const next = vi.fn();

    superAdminOnly(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a SUPER_ADMIN', () => {
    const req = { user: { role: 'SUPER_ADMIN' } } as any;
    const res = makeRes();
    const next = vi.fn();

    superAdminOnly(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });
});

describe('runWithTenant — AsyncLocalStorage context', () => {
  it('isolates schoolId between concurrent async flows', async () => {
    const results: Array<{ expected: number; actual: number | null }> = [];

    await Promise.all([
      runWithTenant({ schoolId: 1 }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push({ expected: 1, actual: currentSchoolId() });
      }),
      runWithTenant({ schoolId: 2 }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push({ expected: 2, actual: currentSchoolId() });
      }),
      runWithTenant({ schoolId: 3 }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        results.push({ expected: 3, actual: currentSchoolId() });
      }),
    ]);

    for (const r of results) {
      expect(r.actual).toBe(r.expected);
    }
  });

  it('exposes bypass flag for super-admin paths', () => {
    runWithTenant({ schoolId: null, bypass: true }, () => {
      const ctx = getTenantContext();
      expect(ctx?.bypass).toBe(true);
      expect(ctx?.schoolId).toBeNull();
    });
  });

  it('returns null schoolId when called outside any tenant scope', () => {
    expect(currentSchoolId()).toBeNull();
  });
});

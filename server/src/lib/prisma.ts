import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

type TenantContext = {
  schoolId: number | null;
  bypass?: boolean;
};

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function currentSchoolId(): number | null {
  return tenantStorage.getStore()?.schoolId ?? null;
}

const TENANT_SCOPED_MODELS = new Set([
  'Student',
  'Teacher',
  'ExitRequest',
  'Conversation',
  'MessageTemplate',
  'MessageLog',
  'AdminUser',
  'Setting',
  'WhatsappSession',
]);

const READ_OPS = new Set(['findFirst', 'findMany', 'findUnique', 'count', 'aggregate', 'groupBy']);
const WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const CREATE_OPS = new Set(['create', 'createMany']);

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createPrismaClient> };

function injectSchoolIdIntoWhere(args: any, schoolId: number): any {
  const next = { ...(args ?? {}) };
  next.where = { ...(next.where ?? {}), schoolId };
  return next;
}

function injectSchoolIdIntoData(data: any, schoolId: number): any {
  if (Array.isArray(data)) {
    return data.map((d) => ({ schoolId, ...d }));
  }
  return { schoolId, ...data };
}

function createPrismaClient() {
  const base = new PrismaClient();
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = tenantStorage.getStore();
          if (!ctx || ctx.bypass) return query(args);
          if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);
          const { schoolId } = ctx;
          if (schoolId == null) {
            throw new Error(
              `Prisma query on tenant-scoped model ${model} without an active schoolId. ` +
                `Wrap the call in runWithTenant({ schoolId }) or runWithTenant({ schoolId: null, bypass: true }) for super-admin paths.`,
            );
          }
          if (READ_OPS.has(operation) || WRITE_OPS.has(operation)) {
            return query(injectSchoolIdIntoWhere(args, schoolId));
          }
          if (CREATE_OPS.has(operation)) {
            const next = { ...(args as any) };
            next.data = injectSchoolIdIntoData(next.data, schoolId);
            return query(next);
          }
          return query(args);
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

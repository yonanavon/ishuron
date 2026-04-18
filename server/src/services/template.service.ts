import { prisma, runWithTenant } from '../lib/prisma';

// Per-school template cache: Map<schoolId, Map<key, body>>
const caches = new Map<number, Map<string, string>>();

async function loadForSchool(schoolId: number): Promise<Map<string, string>> {
  const templates = await runWithTenant({ schoolId }, () =>
    prisma.messageTemplate.findMany(),
  );
  const map = new Map(templates.map((t) => [t.key, t.body]));
  caches.set(schoolId, map);
  return map;
}

/**
 * Pre-warm caches for all active schools. Called once at startup but
 * renderTemplate also lazily loads on miss, so this is optional.
 */
export async function loadTemplates(): Promise<void> {
  const schools = await runWithTenant({ schoolId: null, bypass: true }, () =>
    prisma.school.findMany({ where: { isActive: true }, select: { id: true } }),
  );
  for (const s of schools) {
    await loadForSchool(s.id);
  }
}

export async function renderTemplate(
  schoolId: number,
  key: string,
  vars: Record<string, string> = {},
): Promise<string> {
  let cache = caches.get(schoolId);
  if (!cache) cache = await loadForSchool(schoolId);

  let body = cache.get(key);
  if (!body) {
    // Refresh in case template was added/updated after cache load.
    cache = await loadForSchool(schoolId);
    body = cache.get(key);
    if (!body) return `[תבנית "${key}" לא נמצאה]`;
  }

  return body.replace(/\{\{(\w+)\}\}/g, (match, varName) => vars[varName] ?? match);
}

export function invalidateTemplateCache(schoolId?: number): void {
  if (schoolId == null) {
    caches.clear();
  } else {
    caches.delete(schoolId);
  }
}

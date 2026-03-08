import { prisma } from '../lib/prisma';

// Cache templates in memory
let templateCache: Map<string, string> = new Map();
let cacheLoaded = false;

export async function loadTemplates(): Promise<void> {
  const templates = await prisma.messageTemplate.findMany();
  templateCache = new Map(templates.map(t => [t.key, t.body]));
  cacheLoaded = true;
}

export async function renderTemplate(key: string, vars: Record<string, string> = {}): Promise<string> {
  if (!cacheLoaded) await loadTemplates();

  let body = templateCache.get(key);
  if (!body) {
    // Try loading from DB in case it was added after cache
    await loadTemplates();
    body = templateCache.get(key);
    if (!body) return `[תבנית "${key}" לא נמצאה]`;
  }

  // Replace {{variable}} placeholders
  return body.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return vars[varName] ?? match;
  });
}

export function invalidateTemplateCache(): void {
  cacheLoaded = false;
}

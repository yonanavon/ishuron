import { Request, Response, NextFunction } from 'express';
import { prisma, runWithTenant } from '../lib/prisma';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'tenant-middleware' });

const SUPER_ADMIN_SLUG = process.env.SUPER_ADMIN_SLUG || 'admin';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'ishuron.com';
const DEV_DEFAULT_SLUG = process.env.DEV_DEFAULT_SLUG || 'default';

export interface SchoolContext {
  id: number;
  slug: string;
  name: string;
  logoUrl: string | null;
  timezone: string;
}

declare global {
  namespace Express {
    interface Request {
      school?: SchoolContext;
      schoolId?: number;
      isSuperAdminHost?: boolean;
    }
  }
}

function extractSubdomain(hostname: string): string | null {
  const host = hostname.split(':')[0];

  // Support *.localhost and *.<ROOT_DOMAIN>
  if (host === 'localhost' || host === ROOT_DOMAIN) return null;

  if (host.endsWith('.localhost')) {
    return host.slice(0, -'.localhost'.length);
  }
  if (host.endsWith('.' + ROOT_DOMAIN)) {
    return host.slice(0, -('.' + ROOT_DOMAIN).length);
  }

  // Unknown host — treat first label as subdomain if there's at least one dot.
  const parts = host.split('.');
  if (parts.length >= 2) return parts[0];
  return null;
}

/**
 * Resolves the tenant (School) from the request hostname's subdomain and
 * makes it available both on `req` and inside AsyncLocalStorage so the
 * Prisma extension auto-scopes queries.
 *
 * Special case: the reserved SUPER_ADMIN_SLUG subdomain bypasses tenant
 * scoping entirely — super-admin routes are allowed to query across schools.
 */
export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const slug = extractSubdomain(req.hostname) ?? (
    process.env.NODE_ENV !== 'production' ? DEV_DEFAULT_SLUG : null
  );

  if (!slug) {
    res.status(400).json({ error: 'לא ניתן לזהות בית ספר מכתובת ה-URL' });
    return;
  }

  if (slug === SUPER_ADMIN_SLUG) {
    req.isSuperAdminHost = true;
    runWithTenant({ schoolId: null, bypass: true }, () => next());
    return;
  }

  try {
    const school = await prisma.school.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, logoUrl: true, timezone: true, isActive: true },
    });

    if (!school || !school.isActive) {
      log.warn({ slug }, 'unknown or inactive school');
      res.status(404).json({ error: 'בית ספר לא נמצא' });
      return;
    }

    req.school = {
      id: school.id,
      slug: school.slug,
      name: school.name,
      logoUrl: school.logoUrl,
      timezone: school.timezone,
    };
    req.schoolId = school.id;

    runWithTenant({ schoolId: school.id }, () => next());
  } catch (err) {
    log.error({ err, slug }, 'tenant resolution failed');
    res.status(500).json({ error: 'שגיאה בזיהוי בית ספר' });
  }
}

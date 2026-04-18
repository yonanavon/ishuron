import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authMiddleware, superAdminOnly, generateToken } from '../middleware/auth';
import { getWhatsAppRegistry } from '../services/whatsapp-registry';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'route:super' });
const router = Router();

function requireSuperHost(req: Request, res: Response): boolean {
  if (!req.isSuperAdminHost) {
    res.status(404).json({ error: 'לא נמצא' });
    return false;
  }
  return true;
}

router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    if (!requireSuperHost(req, res)) return;
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'שם משתמש וסיסמה נדרשים' });
      return;
    }
    const user = await prisma.adminUser.findFirst({
      where: { username, role: 'SUPER_ADMIN', schoolId: null },
    });
    if (!user) {
      res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
      return;
    }
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: 'SUPER_ADMIN',
      schoolId: null,
    });
    res.json({ token, role: user.role, username: user.username });
  } catch (error) {
    log.error({ err: error }, 'super login error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.use((req, res, next) => {
  if (!requireSuperHost(req, res)) return;
  next();
});
router.use(authMiddleware, superAdminOnly);

router.get('/schools', async (_req: Request, res: Response) => {
  try {
    const schools = await prisma.school.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
            exitRequests: true,
            adminUsers: true,
          },
        },
      },
    });

    const registry = getWhatsAppRegistry();
    const enriched = schools.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      logoUrl: s.logoUrl,
      timezone: s.timezone,
      isActive: s.isActive,
      createdAt: s.createdAt,
      counts: s._count,
      whatsappStatus: registry.getStatusIfExists(s.id),
    }));

    res.json(enriched);
  } catch (error) {
    log.error({ err: error }, 'list schools error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.get('/schools/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            students: true,
            teachers: true,
            exitRequests: true,
            adminUsers: true,
          },
        },
      },
    });
    if (!school) {
      res.status(404).json({ error: 'בית ספר לא נמצא' });
      return;
    }
    res.json(school);
  } catch (error) {
    log.error({ err: error }, 'get school error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

const DEFAULT_TEMPLATES = [
  { key: 'parent_not_found', name: 'הורה לא נמצא', body: 'שלום, המספר שלך לא מזוהה במערכת. אנא פנה למזכירות בית הספר.' },
  { key: 'welcome', name: 'הודעת פתיחה', body: 'שלום {{parentName}}, ברוכים הבאים למערכת אישור יציאות בית הספר. אנא שלח את שם התלמיד/ה, תאריך ושעת היציאה.' },
  { key: 'student_selection', name: 'בחירת תלמיד', body: 'נמצאו מספר תלמידים:\n{{studentList}}\nאנא שלח את המספר המתאים.' },
  { key: 'datetime_request', name: 'בקשת תאריך ושעה', body: 'עבור {{studentName}}, אנא שלח את תאריך ושעת היציאה הרצויים.\nלדוגמה: "היום בשעה 12:00" או "מחר 10:30"' },
  { key: 'request_sent_to_teacher', name: 'בקשה נשלחה למורה', body: 'בקשת היציאה עבור {{studentName}} נשלחה ל{{teacherName}}. אנא המתן לאישור.' },
  { key: 'teacher_approval_request', name: 'בקשת אישור למורה', body: 'שלום {{teacherName}},\nהתקבלה בקשת יציאה:\nתלמיד/ה: {{studentName}}\nכיתה: {{className}}\nתאריך: {{exitDate}}\nשעה: {{exitTime}}\nמבקש: {{parentName}}\n\nאנא השב:\n1. אישור ✅\n2. דחייה ❌' },
  { key: 'teacher_pending', name: 'ממתין לתשובת מורה', body: 'הבקשה עבור {{studentName}} עדיין ממתינה לאישור {{teacherName}}.\n\n1. המתן\n2. הסלם למזכירות\n3. הסלם למנהל' },
  { key: 'request_approved', name: 'בקשה אושרה', body: '✅ בקשת היציאה עבור {{studentName}} אושרה על ידי {{teacherName}}.\nתאריך: {{exitDate}}\nשעה: {{exitTime}}' },
  { key: 'request_rejected', name: 'בקשה נדחתה', body: '❌ בקשת היציאה עבור {{studentName}} נדחתה על ידי {{teacherName}}.' },
  { key: 'guard_notification', name: 'הודעה לשומר', body: '🚪 יציאה מאושרת:\nתלמיד/ה: {{studentName}}\nכיתה: {{className}}\nשעה: {{exitTime}}\nאושר ע"י: {{teacherName}}' },
  { key: 'escalated', name: 'הסלמה', body: 'הבקשה עבור {{studentName}} הועברה ל{{escalatedToName}}.' },
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const RESERVED_SLUGS = new Set(['admin', 'www', 'api', 'app', 'mail', 'ftp', 'localhost']);

router.post('/schools', async (req: Request, res: Response) => {
  try {
    const { slug, name, logoUrl, timezone, adminUsername, adminPassword } = req.body ?? {};
    if (!slug || !name || !adminUsername || !adminPassword) {
      res.status(400).json({ error: 'slug, name, adminUsername, adminPassword נדרשים' });
      return;
    }
    const cleanSlug = String(slug).trim().toLowerCase();
    if (!SLUG_RE.test(cleanSlug) || RESERVED_SLUGS.has(cleanSlug) || cleanSlug === (process.env.SUPER_ADMIN_SLUG || 'admin')) {
      res.status(400).json({ error: 'slug לא תקין (2-32 תווים, אותיות/מספרים/מקף, לא מתחיל/מסתיים במקף)' });
      return;
    }
    const existing = await prisma.school.findUnique({ where: { slug: cleanSlug } });
    if (existing) {
      res.status(409).json({ error: 'slug כבר קיים' });
      return;
    }

    const passwordHash = await bcrypt.hash(String(adminPassword), 10);

    const school = await prisma.$transaction(async (tx) => {
      const s = await tx.school.create({
        data: {
          slug: cleanSlug,
          name: String(name),
          logoUrl: logoUrl ? String(logoUrl) : null,
          timezone: timezone ? String(timezone) : 'Asia/Jerusalem',
          isActive: true,
        },
      });
      await tx.adminUser.create({
        data: {
          schoolId: s.id,
          username: String(adminUsername),
          passwordHash,
          role: 'ADMIN',
        },
      });
      await tx.messageTemplate.createMany({
        data: DEFAULT_TEMPLATES.map((t) => ({ schoolId: s.id, key: t.key, name: t.name, body: t.body })),
      });
      return s;
    });

    log.info({ schoolId: school.id, slug: school.slug }, 'school created');
    res.status(201).json(school);
  } catch (error) {
    log.error({ err: error }, 'create school error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.patch('/schools/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { name, logoUrl, timezone, isActive } = req.body ?? {};
    const data: any = {};
    if (name !== undefined) data.name = String(name);
    if (logoUrl !== undefined) data.logoUrl = logoUrl ? String(logoUrl) : null;
    if (timezone !== undefined) data.timezone = String(timezone);
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const school = await prisma.school.update({ where: { id }, data });

    if (data.isActive === false) {
      try {
        await getWhatsAppRegistry().disconnect(id);
      } catch (err) {
        log.warn({ err, schoolId: id }, 'failed to disconnect whatsapp on deactivate');
      }
    }
    res.json(school);
  } catch (error: any) {
    if (error?.code === 'P2025') {
      res.status(404).json({ error: 'בית ספר לא נמצא' });
      return;
    }
    log.error({ err: error }, 'update school error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.delete('/schools/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    await prisma.school.update({ where: { id }, data: { isActive: false } });
    try {
      await getWhatsAppRegistry().disconnect(id);
    } catch (err) {
      log.warn({ err, schoolId: id }, 'failed to disconnect whatsapp on soft-delete');
    }
    res.json({ success: true });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      res.status(404).json({ error: 'בית ספר לא נמצא' });
      return;
    }
    log.error({ err: error }, 'delete school error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/schools/:id/impersonate', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const school = await prisma.school.findUnique({ where: { id } });
    if (!school) {
      res.status(404).json({ error: 'בית ספר לא נמצא' });
      return;
    }
    const admin = await prisma.adminUser.findFirst({
      where: { schoolId: id, role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
      res.status(404).json({ error: 'אין אדמין לבית הספר הזה' });
      return;
    }
    const token = generateToken({
      userId: admin.id,
      username: admin.username,
      role: 'ADMIN',
      schoolId: id,
    });
    log.info({ schoolId: id, superUserId: req.user?.userId }, 'impersonation token issued');
    res.json({ token, school: { slug: school.slug, name: school.name } });
  } catch (error) {
    log.error({ err: error }, 'impersonate error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma, runWithTenant } from '../lib/prisma';
import { generateToken, authMiddleware } from '../middleware/auth';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'route:auth' });
const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'שם משתמש וסיסמה נדרשים' });
      return;
    }

    if (req.schoolId == null) {
      res.status(400).json({ error: 'התחברות דורשת subdomain של בית ספר' });
      return;
    }

    // Look up AdminUser scoped to this school. Super-admin sign-in happens on
    // the reserved super-admin subdomain (handled separately in super routes).
    const user = await prisma.adminUser.findUnique({
      where: { schoolId_username: { schoolId: req.schoolId, username } },
    });
    if (!user || user.role === 'SUPER_ADMIN') {
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
      role: user.role,
      schoolId: user.schoolId,
    });

    res.json({
      token,
      role: user.role,
      username: user.username,
      school: req.school ? { slug: req.school.slug, name: req.school.name, logoUrl: req.school.logoUrl } : null,
    });
  } catch (error) {
    log.error({ err: error }, 'login error');
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.get('/me', authMiddleware, (req: Request, res: Response) => {
  res.json(req.user);
});

// Public metadata about the current school — used by the client to
// render branding on the login page (no auth required; tenant middleware
// has already resolved req.school).
router.get('/school', (req: Request, res: Response) => {
  if (!req.school) {
    res.status(404).json({ error: 'בית ספר לא נמצא' });
    return;
  }
  res.json({
    slug: req.school.slug,
    name: req.school.name,
    logoUrl: req.school.logoUrl,
    timezone: req.school.timezone,
  });
});

// Prevent unused-import warnings in case runWithTenant is not used elsewhere
void runWithTenant;

export default router;

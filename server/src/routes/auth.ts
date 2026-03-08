import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { generateToken, authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'שם משתמש וסיסמה נדרשים' });
      return;
    }

    const user = await prisma.adminUser.findUnique({ where: { username } });
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
      role: user.role,
    });

    res.json({ token, role: user.role, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.get('/me', authMiddleware, (req: Request, res: Response) => {
  res.json(req.user);
});

export default router;

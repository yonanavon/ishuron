import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: number;
  username: string;
  role: 'ADMIN' | 'GUARD';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'אנא התחבר למערכת' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'טוקן לא תקין' });
  }
}

export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'אין הרשאת מנהל' });
    return;
  }
  next();
}

export function guardOrAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'GUARD') {
    res.status(403).json({ error: 'אין הרשאה' });
    return;
  }
  next();
}

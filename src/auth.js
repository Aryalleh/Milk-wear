import jwt from 'jsonwebtoken';
import { AppError } from './util.js';

const SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role_name, branch: user.branch_id, name: user.fullname },
    SECRET,
    { expiresIn: '12h' }
  );
}

// میدل‌ور احراز هویت: توکن را از هدر Authorization می‌خواند
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'ورود لازم است'));
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    next(new AppError(401, 'توکن نامعتبر است'));
  }
}

// محدودسازی بر اساس نقش
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'دسترسی مجاز نیست'));
    }
    next();
  };
}

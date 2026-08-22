import { AppError } from './util.js';

// میدل‌ور احراز هویت مبتنی بر session سمت سرور
export function authRequired(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;   // { uid, role, branch, branch_name, name }
    return next();
  }
  next(new AppError(401, 'ورود لازم است'));
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

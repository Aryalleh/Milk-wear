import { AppError } from './util.js';

// میدل‌ور احراز هویت مبتنی بر session سمت سرور
export function authRequired(req, res, next) {
  if (req.session && req.session.user) {
    req.user = req.session.user;   // { kind, uid|person_id, role, branch, branch_name, name }
    return next();
  }
  next(new AppError(401, 'ورود لازم است'));
}

// فقط کاربران کارمند (staff): مدیر، متصدی، حسابداری، ...
export function staffRequired(req, res, next) {
  authRequired(req, res, (err) => {
    if (err) return next(err);
    if (req.user.kind !== 'staff') return next(new AppError(403, 'دسترسی مجاز نیست'));
    next();
  });
}

// فقط اشخاص (دامدار/مشتری) که پنل شخصی دارند
export function personRequired(req, res, next) {
  authRequired(req, res, (err) => {
    if (err) return next(err);
    if (req.user.kind !== 'person' || !req.user.person_id)
      return next(new AppError(403, 'این بخش مخصوص پنل شخصی است'));
    next();
  });
}

// محدودسازی بر اساس نقش (برای کارمندان)
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'دسترسی مجاز نیست'));
    }
    next();
  };
}

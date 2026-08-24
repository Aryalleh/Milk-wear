import jwt from 'jsonwebtoken';

export function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role_key, fullname: user.fullname },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// میدل‌ور احراز هویت: توکن را از هدر Authorization می‌خواند
export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'توکن ارسال نشده' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'توکن نامعتبر یا منقضی' });
  }
}

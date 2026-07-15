const jwt = require('jsonwebtoken');
const { pool } = require('../db');

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

// ─── requireAuth — blocks the request if no valid token is present ───────────
async function requireAuth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, username, email, discord_id, badges, alias, two_factor_enabled, created_at FROM users WHERE id = $1',
      [payload.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Invalid token.' });

    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      'SELECT id, username, email, discord_id, badges, created_at FROM users WHERE id = $1',
      [payload.id]
    );
    if (rows[0]) req.user = rows[0];
  } catch (err) {
    // ignore invalid tokens in optional flow
  }
  next();
}

module.exports = { requireAuth, optionalAuth };

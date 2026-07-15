const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { grantSignupBadges, syncBoosterBadge } = require('../lib/badges');
const discordApi = require('../lib/discord');
const { sendCodeEmail, generateCode } = require('../lib/mailer');

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const RESERVED = new Set([
  'admin','api','dashboard','login','logout','register','settings',
  'profile','me','user','users','leaderboard','terms','privacy',
  'support','help','about','contact','eywa','static','assets',
  'forgot-password','reset-password','verify','verification',
]);

const CODE_TTL_MS = 10 * 60 * 1000; 
const MAX_CODE_ATTEMPTS = 5;

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

async function getActiveCode(email, purpose) {
  const { rows } = await pool.query(
    `SELECT * FROM verification_codes
     WHERE LOWER(email) = $1 AND purpose = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email.toLowerCase(), purpose]
  );
  return rows[0] || null;
}

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (!USERNAME_RE.test(username))
      return res.status(400).json({ error: 'Username must be 3–20 chars: letters, numbers, _ or -' });
    if (RESERVED.has(username.toLowerCase()))
      return res.status(400).json({ error: 'That username is reserved.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2 OR LOWER(alias) = $1',
      [username.toLowerCase(), email.toLowerCase()]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Username or email already taken.' });

    const hash = await bcrypt.hash(password, 12);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
        [username.toLowerCase(), email.toLowerCase(), hash]
      );
      const userId = rows[0].id;
      await client.query(
        'INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)',
        [userId, username]
      );
      
      await grantSignupBadges(client, userId);
      await client.query('COMMIT');
      const token = signToken(userId);
      res.status(201).json({ token, username: username.toLowerCase() });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/register/request-code', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (!USERNAME_RE.test(username))
      return res.status(400).json({ error: 'Username must be 3–20 chars: letters, numbers, _ or -' });
    if (RESERVED.has(username.toLowerCase()))
      return res.status(400).json({ error: 'That username is reserved.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2 OR LOWER(alias) = $1',
      [username.toLowerCase(), email.toLowerCase()]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Username or email already taken.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    
    await pool.query(
      `UPDATE verification_codes SET used = TRUE
       WHERE LOWER(email) = $1 AND purpose = 'register' AND used = FALSE`,
      [email.toLowerCase()]
    );
    await pool.query(
      `INSERT INTO verification_codes (email, code, purpose, payload, expires_at)
       VALUES ($1, $2, 'register', $3, $4)`,
      [email.toLowerCase(), code, JSON.stringify({ username: username.toLowerCase(), displayName: username, passwordHash }), expiresAt]
    );

    await sendCodeEmail(email, code, 'register');
    res.json({ success: true });
  } catch (err) {
    console.error('register/request-code error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/register/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: 'Email and code are required.' });

    const row = await getActiveCode(email, 'register');
    if (!row)
      return res.status(400).json({ error: 'Code expired or not found. Request a new one.' });

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }

    if (row.code !== String(code).trim()) {
      await pool.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    const { username, displayName, passwordHash } = row.payload;

    
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2 OR LOWER(alias) = $1',
      [username, email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);
      return res.status(409).json({ error: 'Username or email already taken.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
        [username, email.toLowerCase(), passwordHash]
      );
      const userId = rows[0].id;
      await client.query(
        'INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)',
        [userId, displayName || username]
      );
      await grantSignupBadges(client, userId);
      await client.query(
        'UPDATE verification_codes SET used = TRUE WHERE id = $1',
        [row.id]
      );
      await client.query('COMMIT');
      const token = signToken(userId);
      res.status(201).json({ token, username });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('register/verify-code error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'A valid email is required.' });

    const { rows } = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [email.toLowerCase()]
    );

    if (rows.length > 0) {
      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);

      await pool.query(
        `UPDATE verification_codes SET used = TRUE
         WHERE LOWER(email) = $1 AND purpose = 'reset' AND used = FALSE`,
        [email.toLowerCase()]
      );
      await pool.query(
        `INSERT INTO verification_codes (email, code, purpose, expires_at)
         VALUES ($1, $2, 'reset', $3)`,
        [email.toLowerCase(), code, expiresAt]
      );

      await sendCodeEmail(email, code, 'reset');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword)
      return res.status(400).json({ error: 'All fields are required.' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const row = await getActiveCode(email, 'reset');
    if (!row)
      return res.status(400).json({ error: 'Code expired or not found. Request a new one.' });

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }

    if (row.code !== String(code).trim()) {
      await pool.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE LOWER(email) = $2', [hash, email.toLowerCase()]);
    await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password)
      return res.status(400).json({ error: 'All fields are required.' });

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1',
      [login.toLowerCase()]
    );
    const user = rows[0];

    if (!user || !user.password)
      return res.status(401).json({ error: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(401).json({ error: 'Invalid credentials.' });

    if (user.two_factor_enabled) {
      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);

      await pool.query(
        `UPDATE verification_codes SET used = TRUE
         WHERE LOWER(email) = $1 AND purpose = 'login2fa' AND used = FALSE`,
        [user.email.toLowerCase()]
      );
      await pool.query(
        `INSERT INTO verification_codes (email, code, purpose, expires_at)
         VALUES ($1, $2, 'login2fa', $3)`,
        [user.email.toLowerCase(), code, expiresAt]
      );
      await sendCodeEmail(user.email, code, 'login2fa');

      return res.json({ requires2fa: true, email: user.email });
    }

    res.json({ token: signToken(user.id), username: user.username });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/login/verify-2fa', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: 'Email and code are required.' });

    const row = await getActiveCode(email, 'login2fa');
    if (!row)
      return res.status(400).json({ error: 'Code expired or not found. Log in again.' });

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Too many incorrect attempts. Log in again.' });
    }

    if (row.code !== String(code).trim()) {
      await pool.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    const { rows } = await pool.query('SELECT id, username FROM users WHERE LOWER(email) = $1', [email.toLowerCase()]);
    const user = rows[0];
    if (!user)
      return res.status(400).json({ error: 'Account not found.' });

    await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);

    res.json({ token: signToken(user.id), username: user.username });
  } catch (err) {
    console.error('login/verify-2fa error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  res.json(req.user);
});

router.get('/check/:username', async (req, res) => {
  const { username } = req.params;
  if (!USERNAME_RE.test(username))
    return res.json({ available: false, reason: 'invalid' });
  if (RESERVED.has(username.toLowerCase()))
    return res.json({ available: false, reason: 'reserved' });

  const { rows } = await pool.query(
    'SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(alias) = $1',
    [username.toLowerCase()]
  );
  res.json({ available: rows.length === 0 });
});

router.get('/discord', (req, res) => {
  if (!process.env.DISCORD_CLIENT_ID)
    return res.status(503).json({ error: 'Discord OAuth not configured.' });

  
  
  
  const linkToken = typeof req.query.link === 'string' ? req.query.link : '';

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    ...(linkToken ? { state: linkToken } : {}),
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get('/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect(`${process.env.BASE_URL}/login?error=no_code`);

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('No access token from Discord');

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    
    let linkedUserId = null;
    if (state) {
      try {
        const payload = jwt.verify(state, process.env.JWT_SECRET);
        linkedUserId = payload.id;
      } catch {  }
    }

    let userId;

    if (linkedUserId) {
      
      const { rows: taken } = await pool.query(
        'SELECT id FROM users WHERE discord_id = $1 AND id != $2',
        [discordUser.id, linkedUserId]
      );
      if (taken.length > 0) {
        return res.redirect(`${process.env.BASE_URL}/dashboard?error=discord_already_linked`);
      }
      await pool.query('UPDATE users SET discord_id = $1 WHERE id = $2', [discordUser.id, linkedUserId]);
      userId = linkedUserId;
    } else {
      const { rows: existing } = await pool.query(
        'SELECT * FROM users WHERE discord_id = $1 OR LOWER(email) = $2',
        [discordUser.id, (discordUser.email || '').toLowerCase()]
      );

      if (existing.length > 0) {
        const user = existing[0];
        if (!user.discord_id) {
          await pool.query('UPDATE users SET discord_id = $1 WHERE id = $2', [discordUser.id, user.id]);
        }
        userId = user.id;
      } else {
        let baseUsername = discordUser.username
          .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'user';
        let username = baseUsername;
        let suffix = 1;
        while (true) {
          const { rows: takenName } = await pool.query(
            'SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(alias) = $1',
            [username]
          );
          if (takenName.length === 0 && !RESERVED.has(username)) break;
          username = `${baseUsername.slice(0, 17)}${suffix++}`;
        }

        const avatarUrl = discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.webp?size=256`
          : '';

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { rows } = await client.query(
            'INSERT INTO users (username, email, discord_id) VALUES ($1, $2, $3) RETURNING id',
            [username, (discordUser.email || '').toLowerCase(), discordUser.id]
          );
          userId = rows[0].id;
          await client.query(
            'INSERT INTO profiles (user_id, display_name, avatar_url) VALUES ($1, $2, $3)',
            [userId, discordUser.global_name || username, avatarUrl]
          );
          await grantSignupBadges(client, userId);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      }
    }

    
    if (discordApi.configured()) {
      try {
        const boosting = await discordApi.isBoosting(discordUser.id);
        await syncBoosterBadge(pool, userId, boosting);
      } catch (e) {
        console.error('booster sync failed:', e);
      }
    }

    const token = signToken(userId);
    res.redirect(`${process.env.BASE_URL}/dashboard?token=${token}`);
  } catch (err) {
    console.error('discord oauth error:', err);
    res.redirect(`${process.env.BASE_URL}/login?error=discord_failed`);
  }
});

router.post('/discord/unlink', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET discord_id = NULL WHERE id = $1', [req.user.id]);
    await syncBoosterBadge(pool, req.user.id, false);
    res.json({ success: true });
  } catch (err) {
    console.error('discord unlink error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/discord/refresh', requireAuth, async (req, res) => {
  try {
    if (!req.user.discord_id)
      return res.status(400).json({ error: 'Discord is not connected.' });
    if (!discordApi.configured())
      return res.status(503).json({ error: 'Booster sync is not configured on this server.' });

    const boosting = await discordApi.isBoosting(req.user.discord_id);
    const badges = await syncBoosterBadge(pool, req.user.id, boosting);
    res.json({ boosting, badges });
  } catch (err) {
    console.error('discord refresh error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/2fa/enable/request-code', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password)
      return res.status(400).json({ error: 'Password is required.' });

    if (req.user.two_factor_enabled)
      return res.status(400).json({ error: '2FA is already enabled.' });

    const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const ok = rows[0]?.password && await bcrypt.compare(password, rows[0].password);
    if (!ok)
      return res.status(401).json({ error: 'Incorrect password.' });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await pool.query(
      `UPDATE verification_codes SET used = TRUE
       WHERE LOWER(email) = $1 AND purpose = 'enable2fa' AND used = FALSE`,
      [req.user.email.toLowerCase()]
    );
    await pool.query(
      `INSERT INTO verification_codes (email, code, purpose, expires_at)
       VALUES ($1, $2, 'enable2fa', $3)`,
      [req.user.email.toLowerCase(), code, expiresAt]
    );
    await sendCodeEmail(req.user.email, code, 'enable2fa');

    res.json({ success: true });
  } catch (err) {
    console.error('2fa/enable/request-code error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/2fa/enable/verify-code', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code)
      return res.status(400).json({ error: 'Code is required.' });

    const row = await getActiveCode(req.user.email, 'enable2fa');
    if (!row)
      return res.status(400).json({ error: 'Code expired or not found. Request a new one.' });

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }

    if (row.code !== String(code).trim()) {
      await pool.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    await pool.query('UPDATE users SET two_factor_enabled = TRUE, updated_at = NOW() WHERE id = $1', [req.user.id]);
    await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('2fa/enable/verify-code error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password)
      return res.status(400).json({ error: 'Password is required.' });

    const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const ok = rows[0]?.password && await bcrypt.compare(password, rows[0].password);
    if (!ok)
      return res.status(401).json({ error: 'Incorrect password.' });

    await pool.query('UPDATE users SET two_factor_enabled = FALSE, updated_at = NOW() WHERE id = $1', [req.user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('2fa/disable error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/email/request-change', requireAuth, async (req, res) => {
  try {
    const { newEmail, password } = req.body;
    if (!newEmail || !password)
      return res.status(400).json({ error: 'New email and password are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (newEmail.toLowerCase() === req.user.email.toLowerCase())
      return res.status(400).json({ error: 'That is already your current email.' });

    const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const ok = rows[0]?.password && await bcrypt.compare(password, rows[0].password);
    if (!ok)
      return res.status(401).json({ error: 'Incorrect password.' });

    const { rows: taken } = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [newEmail.toLowerCase()]);
    if (taken.length > 0)
      return res.status(409).json({ error: 'That email is already in use.' });

    const codeCurrent = generateCode();
    const codeNew = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    const payload = JSON.stringify({ userId: req.user.id, newEmail: newEmail.toLowerCase() });

    await pool.query(
      `UPDATE verification_codes SET used = TRUE
       WHERE purpose = 'email_change' AND used = FALSE AND (LOWER(email) = $1 OR LOWER(email) = $2)`,
      [req.user.email.toLowerCase(), newEmail.toLowerCase()]
    );
    await pool.query(
      `INSERT INTO verification_codes (email, code, purpose, payload, expires_at)
       VALUES ($1, $2, 'email_change', $3, $4)`,
      [req.user.email.toLowerCase(), codeCurrent, payload, expiresAt]
    );
    await pool.query(
      `INSERT INTO verification_codes (email, code, purpose, payload, expires_at)
       VALUES ($1, $2, 'email_change', $3, $4)`,
      [newEmail.toLowerCase(), codeNew, payload, expiresAt]
    );

    await sendCodeEmail(req.user.email, codeCurrent, 'email_change_current');
    await sendCodeEmail(newEmail, codeNew, 'email_change_new');

    res.json({ success: true });
  } catch (err) {
    console.error('email/request-change error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/email/confirm-change', requireAuth, async (req, res) => {
  try {
    const { codeCurrent, codeNew } = req.body;
    if (!codeCurrent || !codeNew)
      return res.status(400).json({ error: 'Both codes are required.' });

    const rowCurrent = await getActiveCode(req.user.email, 'email_change');
    if (!rowCurrent)
      return res.status(400).json({ error: 'Code expired or not found. Start over.' });

    if (rowCurrent.attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [rowCurrent.id]);
      return res.status(400).json({ error: 'Too many incorrect attempts. Start over.' });
    }
    if (rowCurrent.code !== String(codeCurrent).trim()) {
      await pool.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [rowCurrent.id]);
      return res.status(400).json({ error: 'Incorrect code for your current email.' });
    }
    if (rowCurrent.payload.userId !== req.user.id)
      return res.status(400).json({ error: 'This request does not belong to your account.' });

    const newEmail = rowCurrent.payload.newEmail;
    const rowNew = await getActiveCode(newEmail, 'email_change');
    if (!rowNew)
      return res.status(400).json({ error: 'Code expired or not found. Start over.' });

    if (rowNew.attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [rowNew.id]);
      return res.status(400).json({ error: 'Too many incorrect attempts. Start over.' });
    }
    if (rowNew.code !== String(codeNew).trim()) {
      await pool.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [rowNew.id]);
      return res.status(400).json({ error: 'Incorrect code for your new email.' });
    }

    
    const { rows: taken } = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2',
      [newEmail, req.user.id]
    );
    if (taken.length > 0)
      return res.status(409).json({ error: 'That email was just taken by another account.' });

    await pool.query('UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2', [newEmail, req.user.id]);
    await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = ANY($1)', [[rowCurrent.id, rowNew.id]]);

    res.json({ success: true, email: newEmail });
  } catch (err) {
    console.error('email/confirm-change error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/password/change', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword)
      return res.status(400).json({ error: 'All fields are required.' });
    if (newPassword !== confirmPassword)
      return res.status(400).json({ error: 'New passwords do not match.' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const ok = rows[0]?.password && await bcrypt.compare(currentPassword, rows[0].password);
    if (!ok)
      return res.status(401).json({ error: 'Incorrect current password.' });

    const sameAsOld = await bcrypt.compare(newPassword, rows[0].password);
    if (sameAsOld)
      return res.status(400).json({ error: 'New password must be different from your current password.' });

    const newHash = await bcrypt.hash(newPassword, 12);

    if (!req.user.two_factor_enabled) {
      await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
      return res.json({ success: true, requiresCode: false });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    const payload = JSON.stringify({ userId: req.user.id, passwordHash: newHash });

    await pool.query(
      `UPDATE verification_codes SET used = TRUE
       WHERE LOWER(email) = $1 AND purpose = 'change_password' AND used = FALSE`,
      [req.user.email.toLowerCase()]
    );
    await pool.query(
      `INSERT INTO verification_codes (email, code, purpose, payload, expires_at)
       VALUES ($1, $2, 'change_password', $3, $4)`,
      [req.user.email.toLowerCase(), code, payload, expiresAt]
    );
    await sendCodeEmail(req.user.email, code, 'change_password');

    res.json({ success: true, requiresCode: true });
  } catch (err) {
    console.error('password/change error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/password/verify-code', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code)
      return res.status(400).json({ error: 'Code is required.' });

    const row = await getActiveCode(req.user.email, 'change_password');
    if (!row)
      return res.status(400).json({ error: 'Code expired or not found. Start over.' });

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Too many incorrect attempts. Start over.' });
    }

    if (row.code !== String(code).trim()) {
      await pool.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return res.status(400).json({ error: 'Incorrect code.' });
    }

    if (row.payload.userId !== req.user.id)
      return res.status(400).json({ error: 'This request does not belong to your account.' });

    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [row.payload.passwordHash, req.user.id]);
    await pool.query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [row.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('password/verify-code error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;

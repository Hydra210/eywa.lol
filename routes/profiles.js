const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

function formatProfile(user, profile) {
  return {
    username:     user.username,
    user_number:  user.id,          
    display_name: profile.display_name || user.username,
    bio:          profile.bio,
    avatar_url:   profile.avatar_url,
    banner_url:   profile.banner_url,
    bg_type:      profile.bg_type,
    bg_value:     profile.bg_value,
    layout:       profile.layout,
    accent_color: profile.accent_color,
    font_body:    profile.font_body,
    font_display: profile.font_display,
    cursor:       profile.cursor,
    effects:      profile.effects || {},
    socials:      profile.socials || {},
    links:        profile.links   || [],
    views:        profile.views,
    music_url:    profile.music_url,
    sound_url:    profile.sound_url,
    meta_title:   profile.meta_title,
    meta_desc:    profile.meta_desc,
    created_at:   user.created_at,
    
    
    discord_connected: Boolean(user.discord_id),
    discord_id:        user.discord_id || null,
    badges:            user.badges || [],
    selected_badges:   profile.selected_badges || [],
  };
}

function viewerHash(req) {
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
  const ua  = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 32);
}

router.get('/leaderboard/top', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const { rows } = await pool.query(`
    SELECT u.username, u.id AS user_number, p.display_name, p.avatar_url,
           p.accent_color, p.bio, p.views, u.created_at
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.views DESC
    LIMIT $1
  `, [limit]);
  res.json(rows);
});

router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, username, created_at, discord_id, badges FROM users WHERE LOWER(username) = $1 OR LOWER(alias) = $1',
      [req.params.username.toLowerCase()]
    );
    const user = userRows[0];
    if (!user) return res.status(404).json({ error: 'Profile not found.' });

    const { rows: profileRows } = await pool.query(
      'SELECT * FROM profiles WHERE user_id = $1',
      [user.id]
    );
    const profile = profileRows[0];
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });

    const isOwner = req.user?.id === user.id;
    if (!isOwner) {
      const hash = viewerHash(req);

      
      const { rows: existing } = await pool.query(
        `SELECT id FROM profile_views
         WHERE user_id = $1 AND viewer_hash = $2
           AND viewed_at > NOW() - INTERVAL '24 hours'`,
        [user.id, hash]
      );

      if (existing.length === 0) {
        await pool.query('UPDATE profiles SET views = views + 1 WHERE user_id = $1', [user.id]);
        await pool.query(
          'INSERT INTO profile_views (user_id, viewer_hash, referrer) VALUES ($1, $2, $3)',
          [user.id, hash, req.headers.referer || '']
        );
        profile.views += 1;
      }
    }

    res.json(formatProfile(user, profile));
  } catch (err) {
    console.error('get profile error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ─── GET /api/dashboard ──────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, username, email, discord_id, badges, alias, two_factor_enabled, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { rows: profileRows } = await pool.query(
      'SELECT * FROM profiles WHERE user_id = $1',
      [user.id]
    );

    res.json({
      user: { id: user.id, username: user.username, email: user.email, discord_id: user.discord_id, badges: user.badges || [], alias: user.alias || null, two_factor_enabled: user.two_factor_enabled },
      profile: formatProfile(user, profileRows[0]),
    });
  } catch (err) {
    console.error('dashboard error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.put('/', requireAuth, async (req, res) => {
  const allowed = [
    'display_name', 'bio', 'avatar_url', 'banner_url',
    'bg_type', 'bg_value', 'layout',
    'accent_color', 'font_body', 'font_display', 'cursor',
    'effects', 'socials', 'links', 'selected_badges',
    'music_url', 'sound_url', 'meta_title', 'meta_desc',
  ];
  const jsonbCols = new Set(['effects', 'socials', 'links', 'selected_badges']);

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'No valid fields provided.' });
  if (updates.display_name?.length > 50)
    return res.status(400).json({ error: 'Display name too long (max 50 chars).' });
  if (updates.bio?.length > 500)
    return res.status(400).json({ error: 'Bio too long (max 500 chars).' });

  
  if (updates.selected_badges) {
    if (!Array.isArray(updates.selected_badges))
      return res.status(400).json({ error: 'selected_badges must be an array.' });
    const owned = new Set(req.user.badges || []);
    updates.selected_badges = updates.selected_badges.filter(b => owned.has(b));
  }

  const keys   = Object.keys(updates);
  
  
  
  
  
  
  const values = keys.map(k => jsonbCols.has(k) ? JSON.stringify(updates[k]) : updates[k]);
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  values.push(req.user.id);

  try {
    await pool.query(
      `UPDATE profiles SET ${setClauses}, updated_at = NOW() WHERE user_id = $${values.length}`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    console.error('update profile error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

const ALIAS_RE = /^[a-zA-Z0-9_-]{1,20}$/;

router.put('/alias', requireAuth, async (req, res) => {
  try {
    if (!(req.user.badges || []).includes('beta_tester'))
      return res.status(403).json({ error: 'Claiming an alias is a beta tester perk.' });

    const { alias } = req.body;

    
    if (alias === '' || alias === null || alias === undefined) {
      await pool.query('UPDATE users SET alias = NULL WHERE id = $1', [req.user.id]);
      return res.json({ success: true, alias: null });
    }

    if (!ALIAS_RE.test(alias))
      return res.status(400).json({ error: 'Alias must be 1–20 characters: letters, numbers, _ or -' });

    const { rows } = await pool.query(
      'SELECT id FROM users WHERE (LOWER(username) = $1 OR LOWER(alias) = $1) AND id != $2',
      [alias.toLowerCase(), req.user.id]
    );
    if (rows.length > 0)
      return res.status(409).json({ error: 'That alias is already taken.' });

    await pool.query('UPDATE users SET alias = $1 WHERE id = $2', [alias, req.user.id]);
    res.json({ success: true, alias });
  } catch (err) {
    console.error('set alias error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/links/click', async (req, res) => {
  try {
    const { username, link_id } = req.body;
    if (!username || !link_id) return res.status(400).json({ error: 'Missing fields.' });
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE LOWER(username) = $1',
      [username.toLowerCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    await pool.query(
      'INSERT INTO link_clicks (user_id, link_id, referrer) VALUES ($1, $2, $3)',
      [rows[0].id, link_id, req.headers.referer || '']
    );
    res.json({ success: true });
  } catch (err) {
    console.error('link click error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ─── GET /api/dashboard/analytics ────────────────────────────────────────────
router.get('/analytics', requireAuth, async (req, res) => {
  try {
    const { rows: viewRows }  = await pool.query('SELECT views FROM profiles WHERE user_id = $1', [req.user.id]);
    const { rows: byDay }     = await pool.query(`
      SELECT TO_CHAR(viewed_at, 'YYYY-MM-DD') AS day, COUNT(*) AS count
      FROM profile_views
      WHERE user_id = $1 AND viewed_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day ASC
    `, [req.user.id]);
    const { rows: linkClicks } = await pool.query(`
      SELECT link_id, COUNT(*) AS clicks FROM link_clicks WHERE user_id = $1
      GROUP BY link_id ORDER BY clicks DESC
    `, [req.user.id]);
    const { rows: referrers } = await pool.query(`
      SELECT referrer, COUNT(*) AS count FROM profile_views
      WHERE user_id = $1 AND referrer != ''
      GROUP BY referrer ORDER BY count DESC LIMIT 10
    `, [req.user.id]);
    res.json({ views: viewRows[0]?.views || 0, viewsByDay: byDay, linkClicks, referrers });
  } catch (err) {
    console.error('analytics error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
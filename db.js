const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      username    TEXT    NOT NULL UNIQUE,
      email       TEXT    NOT NULL UNIQUE,
      password    TEXT,
      discord_id  TEXT    UNIQUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name  TEXT,
      bio           TEXT    DEFAULT '',
      avatar_url    TEXT    DEFAULT '',
      banner_url    TEXT    DEFAULT '',
      bg_type       TEXT    DEFAULT 'solid',
      bg_value      TEXT    DEFAULT '#080808',
      layout        TEXT    DEFAULT 'centered',
      accent_color  TEXT    DEFAULT '#35fe7e',
      font_body     TEXT    DEFAULT 'inter',
      font_display  TEXT    DEFAULT 'geist',
      cursor        TEXT    DEFAULT '',
      effects       JSONB   DEFAULT '{}',
      socials       JSONB   DEFAULT '{}',
      links         JSONB   DEFAULT '[]',
      views         INTEGER NOT NULL DEFAULT 0,
      music_url     TEXT    DEFAULT '',
      sound_url     TEXT    DEFAULT '',
      meta_title    TEXT    DEFAULT '',
      meta_desc     TEXT    DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS link_clicks (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      link_id     TEXT    NOT NULL,
      clicked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      referrer    TEXT    DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS profile_views (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewer_hash TEXT    NOT NULL DEFAULT '',
      viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      referrer    TEXT    DEFAULT '',
      country     TEXT    DEFAULT ''
    );

    -- Email verification codes, used for both "verify email to register" and
    -- "forgot password" flows. The payload column holds the pending
    -- registration data (username + hashed password) for the 'register'
    -- purpose so the account is only actually created once the code is confirmed.
    CREATE TABLE IF NOT EXISTS verification_codes (
      id          SERIAL PRIMARY KEY,
      email       TEXT    NOT NULL,
      code        TEXT    NOT NULL,
      purpose     TEXT    NOT NULL, -- 'register' | 'reset'
      payload     JSONB   DEFAULT '{}',
      attempts    INTEGER NOT NULL DEFAULT 0,
      used        BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup
      ON verification_codes (LOWER(email), purpose, used);

    -- Add new columns to existing tables if upgrading
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sound_url TEXT DEFAULT '';
    ALTER TABLE profile_views ADD COLUMN IF NOT EXISTS viewer_hash TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]';
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS selected_badges JSONB DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS alias TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_users_username     ON users(LOWER(username));
    CREATE INDEX IF NOT EXISTS idx_users_alias         ON users(LOWER(alias));
    CREATE INDEX IF NOT EXISTS idx_profile_views_user ON profile_views(user_id);
    CREATE INDEX IF NOT EXISTS idx_pv_dedup           ON profile_views(user_id, viewer_hash);
    CREATE INDEX IF NOT EXISTS idx_link_clicks_user   ON link_clicks(user_id);
  `);

  
  
  
  
  
  
  const { EARLY_SUPPORTER_CAP, BETA_TESTER_CAP } = require('./lib/badges');
  await pool.query(
    `UPDATE users
     SET badges = (
       SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
       FROM jsonb_array_elements(
         COALESCE(badges, '[]'::jsonb)
         || CASE WHEN id <= $1 THEN '["early_supporter"]'::jsonb ELSE '[]'::jsonb END
         || CASE WHEN id <= $2 THEN '["beta_tester"]'::jsonb ELSE '[]'::jsonb END
       ) AS elem
     )
     WHERE id <= $1 OR id <= $2`,
    [EARLY_SUPPORTER_CAP, BETA_TESTER_CAP]
  );

  
  
  
  
  
  await pool.query(
    `UPDATE profiles p
     SET selected_badges = (
       SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
       FROM jsonb_array_elements(
         COALESCE(p.selected_badges, '[]'::jsonb)
         || CASE WHEN u.id <= $1 THEN '["early_supporter"]'::jsonb ELSE '[]'::jsonb END
         || CASE WHEN u.id <= $2 THEN '["beta_tester"]'::jsonb ELSE '[]'::jsonb END
       ) AS elem
     )
     FROM users u
     WHERE p.user_id = u.id AND (u.id <= $1 OR u.id <= $2)`,
    [EARLY_SUPPORTER_CAP, BETA_TESTER_CAP]
  );

  
  
  
  
  
  
  await pool.query(
    `UPDATE users SET badges = badges - 'early_supporter' WHERE id > $1 AND badges ? 'early_supporter'`,
    [EARLY_SUPPORTER_CAP]
  );
  await pool.query(
    `UPDATE users SET badges = badges - 'beta_tester' WHERE id > $1 AND badges ? 'beta_tester'`,
    [BETA_TESTER_CAP]
  );
  await pool.query(
    `UPDATE profiles p SET selected_badges = selected_badges - 'early_supporter'
     FROM users u WHERE p.user_id = u.id AND u.id > $1 AND p.selected_badges ? 'early_supporter'`,
    [EARLY_SUPPORTER_CAP]
  );
  await pool.query(
    `UPDATE profiles p SET selected_badges = selected_badges - 'beta_tester'
     FROM users u WHERE p.user_id = u.id AND u.id > $1 AND p.selected_badges ? 'beta_tester'`,
    [BETA_TESTER_CAP]
  );

  console.log('Database ready.');
}

module.exports = { pool, initDB };

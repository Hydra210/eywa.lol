# eywa.lol — Backend

Express.js + SQLite backend for the eywa.lol link-in-bio platform.

## Stack

- **Runtime**: Node.js 18+
- **Framework**: Express
- **Database**: SQLite (via better-sqlite3 — single file, zero config)
- **Auth**: JWT + bcrypt, Discord OAuth optional
- **Rate limiting**: express-rate-limit

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET to a long random string:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Drop your frontend files in public/
#    (index.html, login.html, register.html, dashboard.html, css/, etc.)

# 4. Start
npm run dev     # development (auto-restart)
npm start       # production
```

The database file `eywa.db` is created automatically on first run.

---

## Folder structure

```
eywa-backend/
├── server.js           # Entry point
├── db.js               # SQLite setup + schema
├── middleware/
│   └── auth.js         # JWT middleware
├── routes/
│   ├── auth.js         # /api/auth/*
│   └── profiles.js     # /api/profiles/* + /api/dashboard
└── public/             # ← put your HTML/CSS here
```

---

## API reference

### Auth

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | `{ username, email, password }` | Create account |
| POST | `/api/auth/login` | `{ login, password }` | Login (email or username) |
| GET | `/api/auth/me` | — | Get own user info (auth required) |
| GET | `/api/auth/check/:username` | — | Check username availability |
| GET | `/api/auth/discord` | — | Start Discord OAuth flow |
| GET | `/api/auth/discord/callback` | — | Discord OAuth callback |

Successful auth returns `{ token, username }`. Store the token and send it as:
```
Authorization: Bearer <token>
```

### Profiles

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/profiles/:username` | Optional | Public profile data + increments views |
| GET | `/api/dashboard` | ✅ | Get own profile + user info |
| PUT | `/api/dashboard` | ✅ | Update own profile (any subset of fields) |
| GET | `/api/dashboard/analytics` | ✅ | Views by day, link clicks, referrers |
| POST | `/api/dashboard/links/click` | — | Record a link click |
| GET | `/api/profiles/leaderboard/top` | — | Top profiles by views |

### Update profile — accepted fields

```json
{
  "display_name":  "axelite",
  "bio":           "designer · coder · night owl",
  "avatar_url":    "https://...",
  "banner_url":    "https://...",
  "bg_type":       "solid | gradient | image | gif",
  "bg_value":      "#0a0a0f",
  "layout":        "centered | side-card | wide",
  "accent_color":  "#5eead4",
  "font_body":     "inter",
  "font_display":  "syne",
  "cursor":        "default",
  "effects":       { "particles": true, "rain": false, "glitch": false },
  "socials":       { "twitter": "axelite", "github": "axelite", "discord": "axelite#0001" },
  "links":         [{ "id": "abc1", "title": "My YouTube", "url": "https://...", "icon": "youtube" }],
  "music_url":     "https://open.spotify.com/...",
  "meta_title":    "axelite — creator",
  "meta_desc":     "My links and stuff"
}
```

---

## Connecting your frontend

### Login page (`login.html`)

Replace the `doLogin()` stub with a real API call:

```js
async function doLogin() {
  const login = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const err = document.getElementById('authError');

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  const data = await res.json();

  if (!res.ok) {
    err.textContent = data.error;
    return;
  }

  localStorage.setItem('token', data.token);
  localStorage.setItem('username', data.username);
  window.location.href = '/dashboard';
}
```

### Register page (`register.html`)

```js
async function doRegister() {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  const data = await res.json();
  if (res.ok) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    window.location.href = '/dashboard';
  }
}
```

### Public profile page (`profile.html` → served at `/:username`)

```js
const username = window.location.pathname.slice(1); // "axelite"

const res = await fetch(`/api/profiles/${username}`);
if (!res.ok) { /* show 404 */ return; }
const profile = await res.json();
// Render profile.display_name, profile.bio, profile.links, etc.
```

### Auth helper (include on dashboard pages)

```js
function getToken() { return localStorage.getItem('token'); }

async function apiFetch(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
      ...opts.headers,
    },
  });
}
```

---

## Discord OAuth setup

1. Go to https://discord.com/developers/applications → New Application
2. Under OAuth2 → Redirects, add: `http://localhost:3000/api/auth/discord/callback`
3. Fill in `.env`:
   ```
   DISCORD_CLIENT_ID=your_client_id
   DISCORD_CLIENT_SECRET=your_client_secret
   DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback
   ```
4. The "Continue with Discord" button in `login.html` should link to `/api/auth/discord`

---

## Deploying

### Cheap / free options

| Platform | Notes |
|----------|-------|
| **Railway** | Push to GitHub, auto-deploy. Add env vars in dashboard. |
| **Render** | Free tier, SQLite persists on disk volume. |
| **Fly.io** | `fly launch` — great for SQLite apps. Add a volume for the DB. |
| **VPS (Hetzner/DigitalOcean)** | Run behind nginx + pm2. |

### Production checklist
- [ ] Set a strong `JWT_SECRET`
- [ ] Set `NODE_ENV=production`
- [ ] Point `STATIC_DIR` at your built frontend
- [ ] Run behind a reverse proxy (nginx/Caddy) for HTTPS
- [ ] Add a persistent volume so uploaded files in `public/uploads` survive redeploys
- [ ] Consider Cloudinary or S3 for avatar/banner/music uploads (multer is included in deps)

---

## Recent changes

- **Fixed a critical bug**: `middleware/auth.js` was an accidental duplicate of `routes/auth.js`
  and never actually defined `requireAuth`/`optionalAuth`. This crashed the server on startup,
  which was the underlying cause of the cursor, effects, and Discord widget all appearing broken
  — none of it could ever load or save. It's now a real middleware file.
- **Music uploads**: you can now upload an `.mp3`/`.ogg` file directly (Profile tab → Music),
  in addition to pasting a Spotify/SoundCloud/YouTube/direct-link URL.
- **Cursor & effects**: the custom cursor was already wired up correctly; it just never worked
  because the server couldn't run. The effects toggles (particles, rain, snow, glitch, aurora)
  are now actually rendered on the public profile — previously only the "Discord widget" toggle
  did anything.
- **Discord — now requires real OAuth**: the Discord widget on a profile only appears if the
  owner has gone through `/api/auth/discord` (Dashboard → Discord & Badges → Connect Discord).
  A manually-typed Discord handle in the Socials tab no longer triggers the widget — it's just
  a regular social link/icon. See `lib/discord.js` and the `discord_id` column.
- **Badges**: `early_supporter` and `beta_tester` are auto-granted to the first 1,000 registered
  users (by ascending user id) at signup, in `lib/badges.js`. The `booster` badge is granted/
  revoked automatically by checking the user's Discord guild-member object for `premium_since`
  — this requires `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` to be set (see `.env.example`); a bot
  with no special permissions just needs to be invited to your server. Users pick which of their
  earned badges to display via `selected_badges` in the dashboard.

const router = require('express').Router();
const discordApi = require('../lib/discord');
const discordGateway = require('../lib/discordGateway');

const ID_RE = /^[0-9]{15,21}$/;

function defaultAvatarIndex(id) {
  try {
    return Number((BigInt(id) >> 22n) % 6n);
  } catch {
    return 0;
  }
}

function resolveAssetUrl(applicationId, image) {
  if (!image) return null;
  if (image.startsWith('mp:external/')) {
    const url = image.replace(/^mp:external\//, '');
    return url.startsWith('http') ? url : `https://${url}`;
  }
  if (image.startsWith('spotify:')) {
    return `https://i.scdn.co/image/${image.replace('spotify:', '')}`;
  }
  if (!applicationId) return null;
  return `https://cdn.discordapp.com/app-assets/${applicationId}/${image}.png`;
}

const ACTIVITY_TYPE_LABEL = { 0: 'Playing', 1: 'Streaming', 2: 'Listening', 3: 'Watching', 5: 'Competing' };

function lanyardActivityToSnapshot(a) {
  const isSpotify = a.type === 2 && a.name === 'Spotify';
  return {
    kind: isSpotify ? 'spotify' : 'activity',
    type_label: isSpotify ? 'Listening to Spotify' : (ACTIVITY_TYPE_LABEL[a.type] || 'Playing'),
    name: a.name,
    details: a.details || '',
    state: a.state || '',
    image_url: resolveAssetUrl(a.application_id, a.assets?.large_image) || null,
    url: a.url || null,
    timestamps: a.timestamps ? { start: a.timestamps.start || null, end: a.timestamps.end || null } : null,
  };
}

// ─── GET /api/discord/presence/:id ──────────────────────────────────────────
// Public widget data for a Discord user shown on a profile page.
//
// Live status + activity can only come from Discord's Gateway — the REST API

router.get('/presence/:id', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'Invalid Discord id.' });

  let username = null;
  let displayName = null;
  let avatarHash = null;
  let status = 'offline';
  let customStatus = null;
  let activities = [];

  
  
  const live = discordGateway.getMemberSnapshot(id);
  if (live) {
    username = live.username;
    displayName = live.displayName;
    avatarHash = live.avatarHash;
    status = live.status;
    customStatus = live.customStatus;
    activities = live.activities;
  }

  
  
  if (!username || activities.length === 0) {
    try {
      const r = await fetch(`https://api.lanyard.rest/v1/users/${id}`);
      const j = await r.json();
      if (j.success) {
        const u = j.data.discord_user;
        username = username || u.username;
        displayName = displayName || u.global_name || u.username;
        avatarHash = avatarHash || u.avatar;
        if (!live) status = j.data.discord_status || 'offline';
        if (activities.length === 0) {
          if (j.data.listening_to_spotify && j.data.spotify) {
            const sp = j.data.spotify;
            activities.push({
              kind: 'spotify',
              type_label: 'Listening to Spotify',
              name: sp.song,
              details: `by ${sp.artist}`,
              state: sp.album || '',
              image_url: sp.album_art_url || null,
              url: sp.track_id ? `https://open.spotify.com/track/${sp.track_id}` : null,
              timestamps: sp.timestamps ? { start: sp.timestamps.start, end: sp.timestamps.end } : null,
            });
          }
          (j.data.activities || [])
            .filter(x => x.type !== 4 && !(x.type === 2 && x.name === 'Spotify'))
            .forEach(a => activities.push(lanyardActivityToSnapshot(a)));
          if (!customStatus) {
            const custom = (j.data.activities || []).find(x => x.type === 4);
            if (custom) customStatus = { text: custom.state || '', emoji: custom.emoji?.id ? null : (custom.emoji?.name || null) };
          }
        }
      }
    } catch {
      // Lanyard unreachable — fine, we may already have data from the gateway.
    }
  }

  // 3. Bare guild-member REST lookup — last resort for avatar/name only.
  //    REST has no presence data, so status/activity stay as already set.
  if (!username && discordApi.configured()) {
    try {
      const member = await discordApi.getGuildMember(id);
      if (member && member.user) {
        username = member.user.username;
        displayName = member.nick || member.user.global_name || member.user.username;
        avatarHash = member.avatar || member.user.avatar;
      }
    } catch {
      // ignore — handled by the 404 below
    }
  }

  if (!username) {
    return res.status(404).json({ error: 'Could not load this Discord account.' });
  }

  const avatar_url = avatarHash
    ? `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.webp?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(id)}.png`;

  // Banner + accent color aren't available from the guild-member object or
  
  
  let banner_url = null;
  let accent_color = null;
  if (discordApi.configured()) {
    try {
      const user = await discordApi.getUser(id);
      if (user?.banner) {
        const ext = user.banner.startsWith('a_') ? 'gif' : 'png';
        banner_url = `https://cdn.discordapp.com/banners/${id}/${user.banner}.${ext}?size=480`;
      }
      if (user?.accent_color != null) {
        accent_color = '#' + user.accent_color.toString(16).padStart(6, '0');
      }
    } catch {
      
    }
  }

  res.json({
    username,
    display_name: displayName || username,
    avatar_url,
    banner_url,
    accent_color,
    status,
    custom_status: customStatus,
    activities,
  });
});

module.exports = router;
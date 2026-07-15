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

router.get('/presence/:id', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'Invalid Discord id.' });

  let username = null;
  let displayName = null;
  let avatarHash = null;
  let status = 'offline';
  let activity = null;

  
  
  const live = discordGateway.getMemberSnapshot(id);
  if (live) {
    username = live.username;
    displayName = live.displayName;
    avatarHash = live.avatarHash;
    status = live.status;
    activity = live.activity;
  }

  
  
  if (!username || !activity) {
    try {
      const r = await fetch(`https://api.lanyard.rest/v1/users/${id}`);
      const j = await r.json();
      if (j.success) {
        const u = j.data.discord_user;
        username = username || u.username;
        displayName = displayName || u.global_name || u.username;
        avatarHash = avatarHash || u.avatar;
        if (!live) status = j.data.discord_status || 'offline';
        if (!activity) {
          if (j.data.listening_to_spotify && j.data.spotify) {
            activity = { type: 'spotify', name: j.data.spotify.song, details: `by ${j.data.spotify.artist}` };
          } else {
            const a = (j.data.activities || []).find(x => x.type !== 4);
            if (a) activity = { type: 'activity', name: a.name, details: a.details || '' };
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

  res.json({
    username,
    display_name: displayName || username,
    avatar_url,
    status,
    activity,
  });
});

module.exports = router;

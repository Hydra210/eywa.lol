

const { Client, GatewayIntentBits, Partials } = require('discord.js');

let client = null;
let ready = false;

function configured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
}

async function start() {
  if (!configured() || client) return;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.GuildMember],
  });

  client.once('clientReady', async (c) => {
    ready = true;
    console.log(`[discord-gateway] connected as ${c.user.tag}`);
    try {
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      
      
      await guild.members.fetch();
    } catch (err) {
      console.error('[discord-gateway] failed to prefetch guild members:', err.message);
    }
  });

  client.on('error', (err) => console.error('[discord-gateway] error:', err.message));
  client.on('shardDisconnect', () => { ready = false; });
  client.on('shardResume', () => { ready = true; });

  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (err) {
    console.error('[discord-gateway] login failed — check DISCORD_BOT_TOKEN and that Presence Intent is enabled:', err.message);
  }
}

const ACTIVITY_TYPE_LABEL = { 0: 'Playing', 1: 'Streaming', 2: 'Listening', 3: 'Watching', 5: 'Competing' };

function buildActivity(a) {
  
  
  
  const isSpotify = a.type === 2 && a.name === 'Spotify';
  let image_url = null;
  try {
    image_url = a.assets?.largeImageURL?.({ size: 128 }) || a.assets?.smallImageURL?.({ size: 64 }) || null;
  } catch {  }

  return {
    kind: isSpotify ? 'spotify' : 'activity',
    type_label: isSpotify ? 'Listening to Spotify' : (ACTIVITY_TYPE_LABEL[a.type] || 'Playing'),
    name: a.name,
    details: a.details || '',
    state: a.state || '',
    image_url,
    url: a.url || null, // present for Streaming (Twitch/YouTube link)
    timestamps: a.timestamps
      ? { start: a.timestamps.start ? a.timestamps.start.getTime() : null, end: a.timestamps.end ? a.timestamps.end.getTime() : null }
      : null,
  };
}

// Returns { username, displayName, avatarHash, status, customStatus, activities }
// for a member of our guild, or null if we have nothing for them yet (bot not
// configured/connected, or the user isn't in the guild).
function getMemberSnapshot(discordId) {
  if (!client || !ready) return null;
  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
  if (!guild) return null;
  const member = guild.members.cache.get(discordId);
  if (!member) return null;

  const presence = member.presence;
  const status = presence?.status || 'offline'; 
  let customStatus = null;
  const activities = [];

  if (presence) {
    for (const a of presence.activities) {
      if (a.type === 4) {
        
        customStatus = { text: a.state || '', emoji: a.emoji ? (a.emoji.id ? null : a.emoji.name) : null };
        continue;
      }
      activities.push(buildActivity(a));
    }
  }

  return {
    username: member.user.username,
    displayName: member.nickname || member.user.globalName || member.user.username,
    avatarHash: member.avatar || member.user.avatar,
    status,
    customStatus,
    activities,
  };
}

module.exports = { start, configured, getMemberSnapshot };
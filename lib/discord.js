

function configured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
}

async function getGuildMember(discordId) {
  if (!configured() || !discordId) return null;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordId}`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
    if (!res.ok) return null; 
    return res.json();
  } catch (err) {
    console.error('discord guild member lookup failed:', err.message);
    return null;
  }
}

async function isBoosting(discordId) {
  const member = await getGuildMember(discordId);
  return Boolean(member && member.premium_since);
}

module.exports = { configured, getGuildMember, isBoosting };

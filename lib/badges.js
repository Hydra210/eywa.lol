

const CATALOG = {
  early_supporter: {
    label: 'Early Supporter',
    icon: '/badges/early_supporter.png',
    color: '#fbbf24',
    description: 'One of the first 100 people to join eywa.lol.',
  },
  beta_tester: {
    label: 'Beta Tester',
    icon: '/badges/beta_tester.png',
    color: '#60a5fa',
    description: 'One of the first 50 members — helped test eywa.lol before launch. Beta testers can also claim a 1–2 character alias.',
  },
  booster: {
    label: 'Server Booster',
    icon: '/badges/booster.png',
    color: '#f472b6',
    description: 'Currently boosting the eywa.lol Discord server.',
  },
};

const EARLY_SUPPORTER_CAP = 100;
const BETA_TESTER_CAP = 50;

async function grantSignupBadges(client, userId) {
  const earned = [];
  if (userId <= EARLY_SUPPORTER_CAP) earned.push('early_supporter');
  if (userId <= BETA_TESTER_CAP) earned.push('beta_tester');
  if (!earned.length) return [];

  await client.query(
    `UPDATE users
     SET badges = (
       SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(badges, '[]'::jsonb) || $2::jsonb) AS elem
     )
     WHERE id = $1`,
    [userId, JSON.stringify(earned)]
  );

  
  
  
  
  await client.query(
    `UPDATE profiles
     SET selected_badges = (
       SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(selected_badges, '[]'::jsonb) || $2::jsonb) AS elem
     )
     WHERE user_id = $1`,
    [userId, JSON.stringify(earned)]
  );

  return earned;
}

async function syncBoosterBadge(pool, userId, boosting) {
  const { rows } = await pool.query('SELECT badges FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return [];
  let badges = rows[0].badges || [];
  const has = badges.includes('booster');

  if (boosting && !has) badges = [...badges, 'booster'];
  if (!boosting && has) badges = badges.filter(b => b !== 'booster');

  await pool.query('UPDATE users SET badges = $2 WHERE id = $1', [userId, JSON.stringify(badges)]);
  return badges;
}

module.exports = { CATALOG, EARLY_SUPPORTER_CAP, BETA_TESTER_CAP, grantSignupBadges, syncBoosterBadge };

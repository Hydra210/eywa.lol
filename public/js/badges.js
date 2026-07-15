const BADGE_CATALOG = {
  early_supporter: { label: 'Early Supporter', icon: '/badges/early_supporter.png', color: '#fbbf24', description: 'One of the first 100 people to join eywa.lol.' },
  beta_tester:      { label: 'Beta Tester',      icon: '/badges/beta_tester.png',      color: '#60a5fa', description: 'One of the first 50 members — helped test eywa.lol before launch. Beta testers can also claim a 1–2 character alias.' },
  booster:          { label: 'Server Booster',   icon: '/badges/booster.png',          color: '#f472b6', description: 'Currently boosting the eywa.lol Discord server.' },
};

function renderBadgePill(id) {
  const b = BADGE_CATALOG[id];
  if (!b) return '';
  return `<span class="eywa-badge" title="${b.label}" style="--bc:${b.color}"><img class="eywa-badge-icon" src="${b.icon}" alt="${b.label}" loading="lazy"/></span>`;
}

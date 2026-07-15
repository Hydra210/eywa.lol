# Badge icons

Drop your custom badge icon images in this folder using these exact filenames
(referenced by `public/js/badges.js`):

- `early_supporter.png` — Early Supporter badge
- `beta_tester.png`     — Beta Tester badge
- `booster.png`         — Server Booster badge

Recommended: square PNG or SVG, transparent background, at least 64×64px
(they're displayed at ~22px with a glow effect on hover, so they get scaled
down — keep them simple/legible at small sizes).

If you add more badges later, add a matching `<id>.png` here and a matching
entry in `BADGE_CATALOG` in both `public/js/badges.js` and `lib/badges.js`.

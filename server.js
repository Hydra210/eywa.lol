require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDB } = require('./db');
const discordGateway = require('./lib/discordGateway');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts. Try again in 15 minutes.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/dashboard', require('./routes/profiles'));
app.use('/api/profiles', require('./routes/profiles'));
app.use('/api/discord', require('./routes/discord'));
app.get('/api/ping', (req, res) => res.json({ ok: true }));

const staticDir = path.resolve(process.env.STATIC_DIR || path.join(__dirname, 'public'));
app.use(express.static(staticDir));

const STATIC_PAGES = ['login', 'register', 'dashboard', 'forgot-password'];
STATIC_PAGES.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(staticDir, `${page}.html`));
  });
  app.get(`/${page}.html`, (req, res) => {
    res.sendFile(path.join(staticDir, `${page}.html`));
  });
});

app.get('/:username', (req, res) => {
  const username = req.params.username;
  
  if (username.includes('.')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(staticDir, 'profile.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`eywa.lol backend running → http://localhost:${PORT}`);
    });

    discordGateway.start();
  })
  .catch(err => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  });
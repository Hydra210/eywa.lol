const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { supabase, BUCKET } = require('../lib/supabase');

const storage = multer.memoryStorage();

const ALLOWED_IMAGE = /\.(jpe?g|png|gif|webp|svg)$/i;
const ALLOWED_VIDEO = /\.(mp4|webm)$/i;
const ALLOWED_CURSOR = /\.(png|cur|svg)$/i;
const ALLOWED_AUDIO = /\.(mp3|ogg|wav)$/i;

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_IMAGE.test(ext) || ALLOWED_VIDEO.test(ext) || ALLOWED_CURSOR.test(ext) || ALLOWED_AUDIO.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed.'));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, 
});

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Uploads are not configured yet on this server.' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const key = `${req.user.id}_${req.file.fieldname}_${Date.now()}${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false,
    });

  if (error) {
    console.error('[upload] Supabase storage error:', error.message);
    return res.status(502).json({ error: 'Upload failed. Try again.' });
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  res.json({ url: data.publicUrl });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Max 15MB.' });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;

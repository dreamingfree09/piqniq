/**
 * routes/resources.js
 *
 * Curated resources library.
 *
 * Supports staff-managed resources that can be:
 * - External links
 * - Uploaded PDFs stored under public/uploads/resources
 *
 * Security:
 * - Uploaded filenames are sanitized (no path traversal)
 * - Access to create/update/delete is protected by permissions
 */
const express = require('express');
const router = express.Router();

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const Resource = require('../models/Resource');
const Tag = require('../models/Tag');

const { Logger } = require('../utils/logger');
const { seedCuratedContent } = require('../utils/seedCuratedContent');

const { isAuthenticated } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { PERMISSIONS } = require('../utils/permissionsCatalog');

const RESOURCES_DIR = path.join(__dirname, '..', 'public', 'uploads', 'resources');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeBasename(name) {
  const base = path.basename(String(name || '')).trim();
  return base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160) || 'file';
}

const normalizeSlugArray = (value) => {
  const arr = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(arr.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))
  ).slice(0, 12);
};

const makeKeyForUrl = (url) => `link:${String(url || '').trim()}`;
const makeKeyForPdf = (fileUrl) => `pdf:${String(fileUrl || '').trim()}`;

const normalizeOptionalText = (value, maxLen) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLen);
};

const normalizeOptionalHttpUrl = (value, maxLen) => {
  if (value === undefined || value === null) return '';
  const s = String(value).trim().slice(0, maxLen);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) throw new Error('URL must start with http:// or https://');
  return s;
};

ensureDir(RESOURCES_DIR);

const nodeEnv = process.env.NODE_ENV || 'development';
const isTestRuntime = nodeEnv === 'test' || process.env.JEST_WORKER_ID !== undefined;
const shouldAutoSeedCurated = !isTestRuntime && nodeEnv !== 'production' && String(process.env.AUTO_SEED_CURATED || '').toLowerCase() === 'true';

let autoSeedPromise = null;
let lastAutoSeedAttemptAt = 0;
const AUTO_SEED_COOLDOWN_MS = 60 * 1000;

const maybeAutoSeedCurated = async () => {
  if (!shouldAutoSeedCurated) return;
  try {
    const hasAny = await Resource.exists({});
    if (hasAny) return;

    // If a seed is already running, wait for it.
    if (autoSeedPromise) {
      await autoSeedPromise;
      return;
    }

    // Rate-limit retries to avoid repeated work if Mongo is unavailable.
    const now = Date.now();
    if (now - lastAutoSeedAttemptAt < AUTO_SEED_COOLDOWN_MS) return;

    lastAutoSeedAttemptAt = now;
    Logger.warn('AUTO_SEED_CURATED enabled: resources empty; seeding curated content');
    autoSeedPromise = seedCuratedContent().finally(() => {
      autoSeedPromise = null;
    });

    await autoSeedPromise;
  } catch (e) {
    Logger.warn('AUTO_SEED_CURATED failed; continuing without auto-seed', { error: e?.message });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RESOURCES_DIR),
  filename: (req, file, cb) => {
    const token = crypto.randomBytes(16).toString('base64url');
    cb(null, `resource-${token}${path.extname(file.originalname || '').slice(0, 10)}`);
  },
});

const uploadPdf = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

// Public: list resources
router.get('/', async (req, res) => {
  try {
    await maybeAutoSeedCurated();

    // Performance: resources are public and mostly static.
    // Cache briefly in production, but avoid caching on localhost (common during first-run seeding).
    const baseUrl = String(process.env.BASE_URL || '').toLowerCase();
    const isLocalBase = !baseUrl || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

    const canCache = nodeEnv === 'production' && !isLocalBase;
    if (canCache) {
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    const tag = String(req.query?.tag || '').trim().toLowerCase();
    const kind = String(req.query?.kind || '').trim();
    const level = String(req.query?.level || '').trim();
    const search = String(req.query?.search || req.query?.q || '').trim();

    const limitRaw = Number.parseInt(String(req.query?.limit || ''), 10);
    const pageRaw = Number.parseInt(String(req.query?.page || ''), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const page = Number.isFinite(pageRaw) ? pageRaw : 1;
    const safeLimit = Math.min(200, Math.max(1, limit));
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * safeLimit;
    if (skip > 10000) return res.status(400).json({ error: 'Page too large' });

    const q = { isActive: true };
    if (tag) q.tags = tag;
    if (kind) q.kind = kind;
    if (level) q.level = level;

    const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const canTextSearch = search.length >= 2;
    if (canTextSearch) {
      q.$text = { $search: search };
    }

    let query = Resource.find(q)
      .select(
        'title description kind level url fileUrl fileOriginalName fileSize tags platformName platformUrl creatorName creatorUrl createdAt updatedAt'
      )
      .skip(skip)
      .limit(safeLimit + 1);

    if (canTextSearch) {
      query = query.sort({ score: { $meta: 'textScore' }, createdAt: -1 });
    } else {
      query = query.sort({ createdAt: -1 });
    }

    let items;
    let hasMore = false;
    try {
      const docs = await query.lean();
      hasMore = docs.length > safeLimit;
      items = docs.slice(0, safeLimit);
    } catch (e) {
      // Fallback when text indexes haven't been created yet.
      if (!canTextSearch || !String(e?.message || '').toLowerCase().includes('text index required')) {
        throw e;
      }

      const rx = new RegExp(escapeRegex(search), 'i');
      const fallback = { ...q };
      delete fallback.$text;
      fallback.$or = [
        { title: rx },
        { description: rx },
        { url: rx },
        { fileOriginalName: rx },
        { tags: rx },
      ];

      const docs = await Resource.find(fallback)
        .select(
          'title description kind level url fileUrl fileOriginalName fileSize tags platformName platformUrl creatorName creatorUrl createdAt updatedAt'
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit + 1)
        .lean();

      hasMore = docs.length > safeLimit;
      items = docs.slice(0, safeLimit);
    }

    return res.json({ items, page: safePage, limit: safeLimit, hasMore });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});

// Admin/staff: list all resources (including inactive)
router.get('/admin', isAuthenticated, requirePermission(PERMISSIONS.RESOURCES_READ), async (req, res) => {
  try {
    const tag = String(req.query?.tag || '').trim().toLowerCase();
    const kind = String(req.query?.kind || '').trim();
    const level = String(req.query?.level || '').trim();

    const q = {};
    if (tag) q.tags = tag;
    if (kind) q.kind = kind;
    if (level) q.level = level;

    const items = await Resource.find(q)
      .populate('createdBy', 'username')
      .select(
        'title description kind level url fileUrl fileOriginalName fileSize fileMimeType tags platformName platformUrl creatorName creatorUrl createdBy isActive createdAt updatedAt'
      )
      .sort({ createdAt: -1 })
      .limit(500);

    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});

// Staff: create a link-based resource (Content role)
router.post('/links', isAuthenticated, requirePermission(PERMISSIONS.RESOURCES_CREATE), async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const kind = String(req.body?.kind || 'documentation').trim();
    const level = String(req.body?.level || 'all').trim();
    const url = String(req.body?.url || '').trim();

    const platformName = normalizeOptionalText(req.body?.platformName, 120);
    const creatorName = normalizeOptionalText(req.body?.creatorName, 120);
    let platformUrl = '';
    let creatorUrl = '';
    try {
      platformUrl = normalizeOptionalHttpUrl(req.body?.platformUrl, 1000);
      creatorUrl = normalizeOptionalHttpUrl(req.body?.creatorUrl, 1000);
    } catch (e) {
      return res.status(400).json({ error: String(e?.message || 'Invalid URL') });
    }

    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const tags = normalizeSlugArray(req.body?.tags);
    if (tags.length) {
      const existing = await Tag.find({ slug: { $in: tags }, isActive: true }).select('slug');
      const allowed = new Set(existing.map((t) => t.slug));
      const invalid = tags.filter((t) => !allowed.has(t));
      if (invalid.length) return res.status(400).json({ error: `Unknown tags: ${invalid.join(', ')}` });
    }

    const key = makeKeyForUrl(url);

    const doc = await Resource.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          title,
          description,
          kind,
          level,
          url,
          tags,
          platformName,
          platformUrl,
          creatorName,
          creatorUrl,
          createdBy: req.session.userId,
          isActive: true,
        },
      },
      { new: true, upsert: true }
    );

    return res.status(201).json({ item: doc });
  } catch (error) {
    if (String(error?.code) === '11000') {
      return res.status(400).json({ error: 'Resource already exists' });
    }
    return res.status(500).json({ error: 'Error creating resource' });
  }
});

// Staff: upload a PDF resource (Content role)
router.post('/pdf', isAuthenticated, requirePermission(PERMISSIONS.RESOURCES_CREATE), uploadPdf.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const header = Buffer.alloc(5);
    const fd = fs.openSync(req.file.path, 'r');
    try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
    if (header.toString('ascii') !== '%PDF-') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File content did not match PDF type' });
    }


    const title = String(req.body?.title || '').trim() || safeBasename(req.file.originalname);
    const description = String(req.body?.description || '').trim();
    const level = String(req.body?.level || 'all').trim();

    const platformName = normalizeOptionalText(req.body?.platformName, 120);
    const creatorName = normalizeOptionalText(req.body?.creatorName, 120);
    let platformUrl = '';
    let creatorUrl = '';
    try {
      platformUrl = normalizeOptionalHttpUrl(req.body?.platformUrl, 1000);
      creatorUrl = normalizeOptionalHttpUrl(req.body?.creatorUrl, 1000);
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: String(e?.message || 'Invalid URL') });
    }

    let rawTags = [];
    if (req.body?.tags) {
      try {
        rawTags = JSON.parse(req.body.tags);
      } catch {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: 'Invalid tags payload' });
      }
    }

    const tags = normalizeSlugArray(rawTags);
    if (tags.length) {
      const existing = await Tag.find({ slug: { $in: tags }, isActive: true }).select('slug');
      const allowed = new Set(existing.map((t) => t.slug));
      const invalid = tags.filter((t) => !allowed.has(t));
      if (invalid.length) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: `Unknown tags: ${invalid.join(', ')}` });
      }
    }

    const fileUrl = `/uploads/resources/${req.file.filename}`;
    const key = makeKeyForPdf(fileUrl);

    const doc = await Resource.findOneAndUpdate(
      { key },
      {
        $setOnInsert: {
          key,
          title,
          description,
          kind: 'pdf',
          level,
          url: '',
          fileUrl,
          fileOriginalName: safeBasename(req.file.originalname),
          fileMimeType: String(req.file.mimetype || ''),
          fileSize: Number(req.file.size || 0),
          tags,
          platformName,
          platformUrl,
          creatorName,
          creatorUrl,
          createdBy: req.session.userId,
          isActive: true,
        },
      },
      { new: true, upsert: true }
    );

    return res.status(201).json({ item: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Error uploading PDF' });
  }
});

// Staff: update resource
router.put('/:id', isAuthenticated, requirePermission(PERMISSIONS.RESOURCES_UPDATE), async (req, res) => {
  try {
    const item = await Resource.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Resource not found' });

    if (req.body?.title !== undefined) item.title = String(req.body.title || '').trim();
    if (req.body?.description !== undefined) item.description = String(req.body.description || '').trim();
    if (req.body?.kind !== undefined) item.kind = String(req.body.kind || '').trim();
    if (req.body?.level !== undefined) item.level = String(req.body.level || '').trim();
    if (req.body?.url !== undefined) item.url = String(req.body.url || '').trim();
    if (req.body?.isActive !== undefined) item.isActive = Boolean(req.body.isActive);

    if (req.body?.platformName !== undefined) item.platformName = normalizeOptionalText(req.body.platformName, 120);
    if (req.body?.creatorName !== undefined) item.creatorName = normalizeOptionalText(req.body.creatorName, 120);
    if (req.body?.platformUrl !== undefined) {
      try {
        item.platformUrl = normalizeOptionalHttpUrl(req.body.platformUrl, 1000);
      } catch (e) {
        return res.status(400).json({ error: String(e?.message || 'Invalid URL') });
      }
    }
    if (req.body?.creatorUrl !== undefined) {
      try {
        item.creatorUrl = normalizeOptionalHttpUrl(req.body.creatorUrl, 1000);
      } catch (e) {
        return res.status(400).json({ error: String(e?.message || 'Invalid URL') });
      }
    }

    if (req.body?.tags !== undefined) {
      const tags = normalizeSlugArray(req.body.tags);
      if (tags.length) {
        const existing = await Tag.find({ slug: { $in: tags }, isActive: true }).select('slug');
        const allowed = new Set(existing.map((t) => t.slug));
        const invalid = tags.filter((t) => !allowed.has(t));
        if (invalid.length) return res.status(400).json({ error: `Unknown tags: ${invalid.join(', ')}` });
      }
      item.tags = tags;
    }

    await item.save();
    return res.json({ item });
  } catch {
    return res.status(500).json({ error: 'Error updating resource' });
  }
});

// Staff: delete resource
router.delete('/:id', isAuthenticated, requirePermission(PERMISSIONS.RESOURCES_DELETE), async (req, res) => {
  try {
    const item = await Resource.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Resource not found' });

    // If it was a PDF, attempt to clean up the stored file.
    if (item.fileUrl) {
      const diskPath = path.join(__dirname, '..', 'public', String(item.fileUrl).replace(/^\/+/, ''));
      try {
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      } catch {
        // ignore
      }
    }

    return res.json({ message: 'Resource deleted' });
  } catch {
    return res.status(500).json({ error: 'Error deleting resource' });
  }
});

module.exports = router;
module.exports.RESOURCES_DIR = RESOURCES_DIR;

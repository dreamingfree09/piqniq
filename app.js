/**
 * app.js
 *
 * Express application entry point.
 *
 * Responsibilities:
 * - Configure security middleware (Helmet/CSP, rate limiting, mongo-sanitize, CORS)
 * - Configure sessions (cookie security varies by environment/base URL)
 * - Mount API routes and serve static frontend assets
 * - Seed system roles + curated content + site content when the DB is available
 */
// Load configuration before logger/privacy modules snapshot environment values.
require('dotenv').config();
const nodeEnv = process.env.NODE_ENV || 'development';
const isTestRuntime = nodeEnv === 'test' || process.env.JEST_WORKER_ID !== undefined;

const defaultDevMongoUri = 'mongodb://localhost:27017/piqniq';
const mongoUri = isTestRuntime
  ? require('./config/testDatabase').resolveTestMongoUri()
  : process.env.MONGODB_URI || defaultDevMongoUri;
process.env.MONGODB_URI = mongoUri;


const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { exec } = require('child_process');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cors = require('cors');
const compression = require('compression');
const { Logger, requestLogger } = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Import database connection
const connectDB = require('./config/database');
const createIndexes = require('./config/indexes');

// Import routes
const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const profileRoutes = require('./routes/profile');
const systemRoutes = require('./routes/system');
const adminRoutes = require('./routes/admin');
const tagsRoutes = require('./routes/tags');
const resourcesRoutes = require('./routes/resources');
const newsRoutes = require('./routes/news');
const searchRoutes = require('./routes/search');
const siteContentRoutes = require('./routes/siteContent');
const emailRoutes = require('./routes/email');
const uploadRoutes = require('./routes/upload');
const chatUploadsRoutes = require('./routes/chatUploads');
const chatGifsRoutes = require('./routes/chatGifs');
const socialRoutes = require('./routes/social');
const portfolioRoutes = require('./routes/portfolio');
const documentsRoutes = require('./routes/documents');
const shareRoutes = require('./routes/share');
const shareCardAdminRoutes = require('./routes/shareCardAdmin');
const studyRoutes = require('./routes/study');
const sitePortfolioRoutes = require('./routes/sitePortfolio');
const { swaggerUi, swaggerSpec } = require('./config/swagger');
const { startChatUploadsCleanup } = require('./utils/chatUploadsCleanup');
const { seedSystemRoles } = require('./utils/seedSystemRoles');
const { seedCuratedContent } = require('./utils/seedCuratedContent');
const { seedSiteContent } = require('./utils/seedSiteContent');

// Page-level auth gate (HTML shells)
const requirePageAuth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  const nextUrl = encodeURIComponent(req.originalUrl || '/livechat.html');
  return res.redirect(302, `/?auth=required&next=${nextUrl}`);
};

const sessionSecret = process.env.SESSION_SECRET || (
  nodeEnv === 'production'
    ? crypto.randomBytes(32).toString('hex')
    : 'dev-session-secret'
);

if (nodeEnv === 'production' && !process.env.SESSION_SECRET) {
  Logger.warn('SESSION_SECRET is not set; using a generated secret for this process. Set SESSION_SECRET to keep sessions stable across restarts.');
}

const sanitizeMongoUri = (uri) => {
  if (!uri) return '';
  try {
    // Support mongodb:// and mongodb+srv://
    const parsed = new URL(uri);
    const protocol = parsed.protocol;
    const host = parsed.host;
    const pathname = parsed.pathname || '';
    const dbName = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const safeDb = dbName ? `/${dbName}` : '';
    return `${protocol}//${host}${safeDb}`;
  } catch {
    // Fallback: strip credentials if present: mongodb://user:pass@host/db
    return uri.replace(/:\/\/(.*@)/, '://');
  }
};

const logStartupSelfCheck = (portBase, portTries) => {
  Logger.info('Startup self-check', {
    environment: nodeEnv,
    baseUrl: process.env.BASE_URL || '',
    cookieSecure,
    portBase,
    portTries,
    mongoUri: sanitizeMongoUri(mongoUri),
    autoSeedCurated: String(process.env.AUTO_SEED_CURATED || '').toLowerCase() === 'true',
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3000'],
    rateLimitEnabled: nodeEnv !== 'test'
  });

  if (nodeEnv === 'production') {
    if (!process.env.MONGODB_URI) {
      Logger.warn('MONGODB_URI is not set; using a fallback local Mongo URI. Set MONGODB_URI for production.');
    }
    if (!process.env.BASE_URL) {
      Logger.warn('BASE_URL is not set; cookie security may not match your deployment. Set BASE_URL (https://...) for production.');
    }
  }
};

const baseUrl = process.env.BASE_URL || '';
const isHttpsBaseUrl = baseUrl.toLowerCase().startsWith('https://');
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE.toLowerCase() === 'true'
  : process.env.NODE_ENV === 'production' && isHttpsBaseUrl;

const parseSessionIdleTimeoutMinutes = () => {
  const raw = String(process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? '').trim();

  // Default: 60 minutes of inactivity.
  // Set to 0/false to disable idle timeout.
  if (!raw) return 60;
  if (raw.toLowerCase() === 'false') return 0;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) return 60;
  return minutes;
};

const sessionIdleTimeoutMinutes = parseSessionIdleTimeoutMinutes();
const sessionIdleTimeoutMs = sessionIdleTimeoutMinutes > 0
  ? Math.max(60_000, Math.floor(sessionIdleTimeoutMinutes * 60_000))
  : 0;

// Reduce session store churn: only update the session activity timestamp at most once per minute.
const sessionActivityTouchMs = 60_000;

// connect-mongo touchAfter is in seconds; keep it comfortably below the idle timeout so TTL can extend.
const sessionStoreTouchAfterSeconds = sessionIdleTimeoutMs > 0
  ? Math.max(60, Math.min(15 * 60, Math.floor((sessionIdleTimeoutMs / 1000) / 4)))
  : 24 * 3600;

app.disable('x-powered-by');

// Performance: gzip compression reduces payload sizes significantly.
// Keep it off in test runtime to avoid changing supertest behaviors.
if (!isTestRuntime) {
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    }
  }));
}

// Security Middleware
// Helmet helps secure Express apps by setting HTTP response headers
app.use(helmet({
  // Only enable HSTS when we are actually serving HTTPS.
  // Sending HSTS on http://localhost can confuse browsers and break sign-in.
  hsts: cookieSecure ? undefined : false,
  contentSecurityPolicy: {
    // Use an explicit CSP so we don't accidentally enable `upgrade-insecure-requests`
    // while running on plain HTTP (which would upgrade fetch/XHR to https://localhost).
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

const parseAllowedOrigins = () => {
  const raw = process.env.ALLOWED_ORIGINS;
  const defaults = ['http://localhost:3000'];
  const list = (raw ? raw.split(',') : defaults)
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  // Security: never allow '*' when credentials are enabled.
  return list.filter((o) => o !== '*');
};

const allowedOrigins = parseAllowedOrigins();
if ((process.env.ALLOWED_ORIGINS || '').includes('*')) {
  Logger.warn("ALLOWED_ORIGINS contains '*', but credentials are enabled. '*' will be ignored.");
}

// Dev ergonomics: if ALLOWED_ORIGINS is not set, allow any localhost origin.
// This makes it safe to port-hop on EADDRINUSE without breaking same-origin fetches.
// Production stays strict and requires explicit allowlisting.
const allowAnyLocalhostOrigin = !process.env.ALLOWED_ORIGINS && nodeEnv !== 'production';
const isLocalhostOrigin = (origin) => {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    return (host === 'localhost' || host === '127.0.0.1');
  } catch {
    return false;
  }
};

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients / same-origin requests may omit Origin.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (allowAnyLocalhostOrigin && isLocalhostOrigin(origin)) return callback(null, true);
    const err = new Error('Not allowed by CORS');
    err.statusCode = 403;
    return callback(err);
  },
  credentials: true
}));

// Data sanitization against NoSQL injection
app.use(mongoSanitize());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true
});

const createPostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 posts per hour
  message: 'Too many posts created, please try again later.'
});

// Apply rate limiting to API routes
if (!isTestRuntime) {
  app.use('/api/', apiLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: isTestRuntime ? undefined : MongoStore.create({
    mongoUrl: mongoUri,
    touchAfter: sessionStoreTouchAfterSeconds // lazy session update
  }),
  cookie: {
    maxAge: sessionIdleTimeoutMs > 0
      ? sessionIdleTimeoutMs
      : 1000 * 60 * 60 * 24 * 7, // fallback: 1 week
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'strict' // CSRF protection
  }
});
app.locals.sessionMiddleware = sessionMiddleware;
app.locals.sessionIdleTimeoutMs = sessionIdleTimeoutMs;
app.use(sessionMiddleware);

// Reject revoked/deleted account sessions on every HTTP route, including optional-auth routes.
const { sessionUser } = require('./middleware/sessionIdentity');
app.use(async (req, res, next) => {
  if (!req.session?.userId) return next();
  try {
    if (await sessionUser(req, sessionIdleTimeoutMs)) return next();
    const sessionId = req.sessionID;
    req.session.destroy(() => {
      global.wsManager?.disconnectSession?.(sessionId);
      res.clearCookie('connect.sid');
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired' });
      return res.redirect(302, '/?auth=expired');
    });
  } catch { return res.status(503).json({ error: 'Authentication temporarily unavailable' }); }
});

// Request logging
app.use(requestLogger);

// Session idle timeout (auto-logout on inactivity)
//
// Behavior:
// - For authenticated sessions, track a last-activity timestamp.
// - If a request arrives after the idle threshold, destroy the session.
// - HTML routes redirect to the home auth modal; API routes return 401.
if (sessionIdleTimeoutMs > 0) {
  app.use((req, res, next) => {
    if (!req.session || !req.session.userId) return next();

    const now = Date.now();
    const last = Number(req.session.lastActivityAt || 0);

    if (last && (now - last) > sessionIdleTimeoutMs) {
      const cookieName = 'connect.sid';
      res.clearCookie(cookieName, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: 'strict',
        path: '/'
      });

      try {
        req.session.destroy(() => {});
      } catch {
        // ignore
      }

      if (String(req.path || '').startsWith('/api/')) {
        return res.status(401).json({ error: 'Session expired due to inactivity' });
      }

      const nextUrl = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(302, `/?auth=expired&next=${nextUrl}`);
    }

    if (!last || (now - last) > sessionActivityTouchMs) {
      req.session.lastActivityAt = now;
    }

    return next();
  });
}

// --- Performance: automatic image optimization (PNG/JPG -> WebP) ---
// Large images are the #1 cause of slow page loads. This middleware serves a
// cached WebP variant when the client supports it, without requiring manual
// re-export of assets.
//
// Safety notes:
// - Uses strict path normalization to prevent path traversal.
// - Falls back to normal static serving if sharp is unavailable or conversion fails.
const enableImageOptimization = !isTestRuntime && process.env.IMAGE_OPTIMIZATION !== 'false';
if (enableImageOptimization) {
  const imagesDirCandidates = [
    path.join(__dirname, 'public', 'images'),
    path.join(__dirname, 'public', 'Images')
  ];

  const imagesRoot = imagesDirCandidates.find((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  }) || imagesDirCandidates[0];

  // Cache outside of /public to avoid accidental direct access.
  const imageCacheRoot = path.join(__dirname, '.cache', 'images-webp');

  let sharpModule;

  app.get(/^\/images\/(.+)$/, async (req, res, next) => {
    const accept = String(req.headers.accept || '');
    if (!accept.includes('image/webp')) return next();

    let requestedPath = '';
    try {
      requestedPath = decodeURIComponent(String(req.params[0] || ''));
    } catch {
      return res.status(400).send('Bad Request');
    }

    // Only optimize common raster formats.
    const lower = requestedPath.toLowerCase();
    if (!(lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg'))) {
      return next();
    }

    // Prevent path traversal and ensure we stay under imagesRoot.
    const normalizedRel = path.normalize(requestedPath).replace(/^([\\/])+/, '');
    const sourcePath = path.join(imagesRoot, normalizedRel);
    if (!sourcePath.startsWith(imagesRoot)) {
      return res.status(400).send('Bad Request');
    }

    let stat;
    try {
      stat = await fsp.stat(sourcePath);
      if (!stat.isFile()) return next();
    } catch {
      return next();
    }

    if (!sharpModule) {
      try {
        // Lazy require so local dev can still run even if sharp fails to install.
        // eslint-disable-next-line global-require
        sharpModule = require('sharp');
      } catch {
        return next();
      }
    }

    const safeKey = normalizedRel.replace(/[\\/]/g, '__');
    const cacheFileName = `${safeKey}.${stat.size}.${Math.floor(stat.mtimeMs)}.webp`;
    const cachePath = path.join(imageCacheRoot, cacheFileName);

    try {
      // Serve cached variant if present.
      try {
        await fsp.access(cachePath, fs.constants.R_OK);
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Vary', 'Accept');
        if (nodeEnv === 'production') {
          res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else {
          // Speed up dev navigation by allowing short-lived caching.
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        return res.sendFile(cachePath);
      } catch {
        // cache miss
      }

      await fsp.mkdir(imageCacheRoot, { recursive: true });

      // Resize very large images (common for hero/slider assets) while preserving aspect ratio.
      // This keeps visuals the same but reduces bytes significantly.
      const transformer = sharpModule(sourcePath)
        .rotate() // normalize orientation if EXIF exists
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 78 });

      await transformer.toFile(cachePath);

      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Vary', 'Accept');
      if (nodeEnv === 'production') {
        res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
      return res.sendFile(cachePath);
    } catch (err) {
      Logger.warn('Image optimization failed; falling back to original asset', {
        path: normalizedRel,
        error: String(err?.message || err)
      });
      return next();
    }
  });
}

// Live Chat (locked to authenticated users)
// IMPORTANT: This must be registered before express.static(), otherwise guests can
// fetch /livechat.html directly from the public folder without hitting requirePageAuth.
app.get(['/livechat', '/livechat.html'], requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'livechat.html'));
});

// Study Room (locked to authenticated users)
// Same reasoning as Live Chat: must be registered before express.static().
app.get(['/study', '/study.html'], requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'study.html'));
});

// Set up static file serving from the "public" folder
const staticMaxAge = nodeEnv === 'production' ? '7d' : 0;
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: staticMaxAge,
  setHeaders: (res, filePath) => {
    // Avoid caching HTML shells aggressively; they may change with deployments.
    if (String(filePath || '').toLowerCase().endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }

    // Cache static assets more aggressively in production.
    if (nodeEnv === 'production') {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    }
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/site-content', siteContentRoutes);
app.use('/api/site-portfolio', sitePortfolioRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/chat', chatUploadsRoutes);
app.use('/api/chat', chatGifsRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/study', studyRoutes);
app.use('/api/share-card', shareCardAdminRoutes);
app.use('/share', shareRoutes);

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Apply stricter rate limit to post creation
if (!isTestRuntime) {
  app.post('/api/posts', createPostLimiter);
}

// Route to handle the home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route to handle the portfolio page
app.get('/portfolio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

// Public portfolio pages: /portfolio/:username
app.get('/portfolio/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

// Route to handle the IT pathways page
app.get('/pathways', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pathways.html'));
});

// Route to handle the forum page
app.get('/forum', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forum.html'));
});

// Route to handle the resources page (friendly URL)
app.get('/resources', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'resources.html'));
});

// Admin panel (friendly URL)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Route to handle dashboard page (friendly URL)
app.get('/profile/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Route to handle user profile page (friendly URL)
app.get('/profile/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Legacy/forum-enhancements compatibility: redirect /post/:id -> forum post view
app.get('/post/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  res.redirect(302, `/forum.html?post=${encodeURIComponent(id)}`);
});

// Route to handle email verification page
app.get('/verify-email', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify-email.html'));
});

// Route to handle password reset page
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// 404 handler for undefined routes
app.use(notFound);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start the server (default port 3000)
const BASE_PORT = Number.parseInt(process.env.PORT || '3000', 10);
// Development ergonomics: allow optional port hopping to avoid hard-failing on EADDRINUSE.
// Production stays pinned to a single port and fails fast.
const DEFAULT_PORT_TRIES = nodeEnv === 'production' ? 0 : 10;
const PORT_TRIES = Number.parseInt(process.env.PORT_TRIES || String(DEFAULT_PORT_TRIES), 10);
let server;

// Only start server if not in test environment
// Only start the server when this file is executed directly (not when imported by tests)
if (!isTestRuntime && require.main === module) {
  // Connect to MongoDB and start server
  connectDB().then(async () => {
    logStartupSelfCheck(BASE_PORT, Number.isFinite(PORT_TRIES) ? PORT_TRIES : 10);

    // As curated content grows, index checks + seeding can slow down startup.
    // Only block on curated content for a truly empty DB; otherwise run maintenance in the background.
    let blockForCuratedContent = false;
    try {
      const Resource = require('./models/Resource');
      const hasAnyResource = await Resource.exists({});
      blockForCuratedContent = !hasAnyResource;
    } catch (e) {
      Logger.warn('Curated content precheck failed; continuing', { error: e?.message });
    }

    const runStartupMaintenance = async () => {
      // Create database indexes after connection (idempotent)
      try {
        await createIndexes();
      } catch (e) {
        Logger.warn('Index creation failed; continuing', { error: e?.message });
      }

      // Ensure default system roles exist (idempotent)
      try {
        const results = await seedSystemRoles();
        const created = results.filter(r => r.created).map(r => r.name);
        if (created.length) {
          Logger.info('Seeded system roles', { created });
        }
      } catch (e) {
        Logger.warn('System role seeding failed; continuing', { error: e?.message });
      }

      // Seed curated tags/resources (idempotent)
      try {
        const res = await seedCuratedContent();
        const createdTags = (res?.tags || []).filter(t => t.created).length;
        const createdResources = (res?.resources || []).filter(r => r.created).length;
        if (createdTags || createdResources) {
          Logger.info('Seeded curated content', { createdTags, createdResources });
        }
      } catch (e) {
        Logger.warn('Curated content seeding failed; continuing', { error: e?.message });
      }

      // Seed site content (idempotent)
      try {
        const res = await seedSiteContent();
        const created = (res || []).filter(r => r.created).map(r => r.slug);
        if (created.length) {
          Logger.info('Seeded site content', { created });
        }
      } catch (e) {
        Logger.warn('Site content seeding failed; continuing', { error: e?.message });
      }
    };

    const tryGetPortOwnerPid = (port) => new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(null);

      // Best-effort: query the owning PID via netstat.
      exec(`netstat -ano | findstr :${port}`, { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const line = String(stdout).split(/\r?\n/).find(Boolean);
        if (!line) return resolve(null);
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        const parsedPid = Number.parseInt(pid, 10);
        return resolve(Number.isFinite(parsedPid) ? parsedPid : null);
      });
    });

    const startServer = (port, remainingTries) => {
      // Use an explicit HTTP server so we can attach `error` handler
      // before `listen()` (prevents a race where EADDRINUSE becomes an uncaught exception).
      server = http.createServer(app);

      server.on('error', async (error) => {
        if (error && error.code === 'EADDRINUSE') {
          const ownerPid = await tryGetPortOwnerPid(port);

          if (nodeEnv !== 'production' && Number.isFinite(remainingTries) && remainingTries > 0) {
            Logger.warn(`Port ${port} is already in use; trying ${port + 1}`, {
              port,
              nextPort: port + 1,
              remainingTries,
              code: error.code,
              ownerPid: ownerPid || undefined
            });

            try { server.close(); } catch { /* noop */ }
            return startServer(port + 1, remainingTries - 1);
          }

          Logger.error(`Port ${port} is already in use.`, {
            port,
            code: error.code,
            ownerPid: ownerPid || undefined,
            hint: 'Stop the existing process (Windows: `npm run kill:port`) or use `npm run start:clean` to kill the port and restart cleanly.'
          });
          process.exit(1);
        }

        Logger.error('Failed to start server', {
          error: error?.message,
          code: error?.code,
          port
        });
        process.exit(1);
      });

      server.listen(port, process.env.HOST || '0.0.0.0', () => {
        Logger.info(`Server running on port ${port}`, {
          environment: process.env.NODE_ENV || 'development',
          port
        });

        // Initialize WebSocket (do not crash the whole server if WS fails)
        try {
          const WebSocketManager = require('./config/websocket');
          global.wsManager = new WebSocketManager(server, sessionMiddleware, {
            sessionIdleTimeoutMs,
            isOriginAllowed: origin => !origin || allowedOrigins.includes(origin) || (allowAnyLocalhostOrigin && isLocalhostOrigin(origin)),
          });
          Logger.info('WebSocket server initialized');
        } catch (wsError) {
          Logger.error('WebSocket initialization failed; continuing without WebSockets', {
            error: wsError?.message,
            stack: wsError?.stack
          });
        }
      });

      server.on('close', () => {
        Logger.warn('HTTP server closed');
      });
    };

    // First-run experience: ensure the site isn't empty before serving.
    if (blockForCuratedContent) {
      await runStartupMaintenance();
    }

    // Start serving requests ASAP.
    startServer(BASE_PORT, Number.isFinite(PORT_TRIES) ? PORT_TRIES : DEFAULT_PORT_TRIES);

    // Cleanup old/orphaned chat uploads on a timer
    startChatUploadsCleanup({ uploadsDir: chatUploadsRoutes.CHAT_UPLOADS_DIR });

    // On non-empty DBs, run maintenance in the background.
    if (!blockForCuratedContent) {
      runStartupMaintenance().catch((e) => {
        Logger.warn('Startup maintenance failed; continuing', { error: e?.message });
      });
    }

  }).catch((error) => {
    Logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  Logger.info('SIGTERM received, shutting down gracefully');
  if (server) {
    server.close(() => {
      Logger.info('Server closed');
      process.exit(0);
    });
  }
});

process.on('unhandledRejection', (reason) => {
  Logger.error('Unhandled Rejection', { reason });
});

process.on('uncaughtException', (error) => {
  Logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = app;

const fs = require('fs');
const path = require('path');
const { stableHash, hashIp, hashUserAgent, hashPrincipal, safeRequestPath } = require('./privacy');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const LOG_MAX_BYTES = Number.parseInt(process.env.LOG_MAX_BYTES || '10485760', 10); // default: 10MB
const SENSITIVE_KEY_RE = /(password|pass|pwd|token|secret|session|cookie|authorization|apiKey|email|verificationUrl|resetUrl)/i;

const redactMeta = (value, key = '') => {
  if (SENSITIVE_KEY_RE.test(String(key || ''))) return '[REDACTED]';
  if (value == null) return value;

  // Common case: MongoDB ObjectId / BSON-ish identifiers.
  if (value && typeof value === 'object' && typeof value.toHexString === 'function') {
    return value.toHexString();
  }
  if (value && typeof value === 'object' && value._bsontype === 'ObjectID' && typeof value.toString === 'function') {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(process.env.NODE_ENV === 'development' && value.stack ? { stack: value.stack } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactMeta(v));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactMeta(v, k);
    }
    return out;
  }

  if (typeof value === 'string') {
    // Avoid huge log entries (DoS / disk exhaustion).
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }

  return value;
};

const rotateIfTooLarge = (filePath) => {
  if (!Number.isFinite(LOG_MAX_BYTES) || LOG_MAX_BYTES <= 0) return;
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    if (stat.size < LOG_MAX_BYTES) return;

    const rotated = `${filePath}.1`;
    try {
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    } catch {
      // ignore
    }
    fs.renameSync(filePath, rotated);
  } catch {
    // ignore rotation failures; logging should never crash the app
  }
};

// Log levels
const LogLevel = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

// Format log message
const formatLog = (level, message, meta = {}) => {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactMeta(meta)
  }) + '\n';
};

// Write to log file
const writeLog = (filename, content) => {
  const filePath = path.join(logsDir, filename);
  rotateIfTooLarge(filePath);
  fs.appendFileSync(filePath, content);
};

// Logger class
class Logger {
  static info(message, meta = {}) {
    const log = formatLog(LogLevel.INFO, message, meta);
    console.log(log.trim());
    writeLog('app.log', log);
  }

  static warn(message, meta = {}) {
    const log = formatLog(LogLevel.WARN, message, meta);
    console.warn(log.trim());
    writeLog('app.log', log);
  }

  static error(message, meta = {}) {
    const log = formatLog(LogLevel.ERROR, message, meta);
    console.error(log.trim());
    writeLog('error.log', log);
    writeLog('app.log', log);
  }

  static debug(message, meta = {}) {
    if (process.env.NODE_ENV === 'development') {
      const log = formatLog(LogLevel.DEBUG, message, meta);
      console.debug(log.trim());
      writeLog('debug.log', log);
    }
  }

  // Log HTTP requests
  static request(req, res, responseTime) {
    const ipHash = req.ip ? hashIp(req.ip) : undefined;
    const ua = req.get('user-agent');
    const userAgentHash = ua ? hashUserAgent(ua) : undefined;

    const log = formatLog(LogLevel.INFO, 'HTTP Request', {
      method: req.method,
      path: safeRequestPath(req),
      status: res.statusCode,
      responseTime: `${responseTime}ms`,
      ...(ipHash ? { ipHash } : {}),
      ...(userAgentHash ? { userAgentHash } : {})
    });
    writeLog('access.log', log);
  }

  // Log authentication events
  static auth(event, username, success, meta = {}) {
    const log = formatLog(
      success ? LogLevel.INFO : LogLevel.WARN,
      `Authentication: ${event}`,
      {
        ...(username ? { principalHash: hashPrincipal(username) } : {}),
        success,
        ...meta
      }
    );
    writeLog('auth.log', log);
    writeLog('app.log', log);
  }
}

// Request logging middleware
const requestLogger = (req, res, next) => {
  const startTime = Date.now();

  // Log when response finishes
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    Logger.request(req, res, responseTime);
  });

  next();
};

module.exports = { Logger, requestLogger };

/**
 * utils/privacy.js
 *
 * Privacy-minded helpers for pseudonymization and safe telemetry.
 *
 * This project stores some operational/security telemetry (e.g. logs, audit events).
 * For GDPR-minded data minimization, we prefer hashing/pseudonymization over storing
 * raw identifiers (IP addresses, user agents, usernames) unless explicitly configured.
 */
const crypto = require('crypto');

const PII_HASH_SALT = process.env.PII_HASH_SALT || process.env.LOG_IP_SALT || '';

const stableHash = (value, { salt = PII_HASH_SALT, length = 24 } = {}) => {
  const raw = String(value ?? '');
  return crypto
    .createHash('sha256')
    .update(`${salt}|${raw}`)
    .digest('hex')
    .slice(0, Math.max(8, Math.min(Number(length) || 24, 64)));
};

const hashIp = (ip) => {
  if (!ip) return '';
  return `ip_${stableHash(ip)}`;
};

const hashUserAgent = (userAgent) => {
  if (!userAgent) return '';
  return `ua_${stableHash(userAgent)}`;
};

const hashPrincipal = (principal) => {
  if (!principal) return '';
  return `p_${stableHash(principal)}`;
};

module.exports = {
  stableHash,
  hashIp,
  hashUserAgent,
  hashPrincipal,
};

// Use route templates where available; token-bearing capability paths are never
// written verbatim even when an early request error occurs before routing.
function safeRequestPath(req) {
  if (typeof req.route?.path === 'string') return String(req.baseUrl || '') + req.route.path;
  return String(req.path || '').replace(/(\/(?:api\/email\/(?:verify|reset-password)|share\/card|api\/chat\/uploads)\/)[^/]+/g, '$1[REDACTED]');
}
module.exports.safeRequestPath = safeRequestPath;

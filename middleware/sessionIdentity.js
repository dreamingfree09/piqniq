/** Bind HTTP and socket principals to a live account and its revocation version. */
const User = require('../models/User');
async function sessionUser(req, idleTimeoutMs = 0) {
  const session = req.session;
  if (!session || !/^[a-f\d]{24}$/i.test(String(session.userId || ''))) return null;
  const now = Date.now();
  const expires = session.cookie?.expires;
  if (expires && new Date(expires).getTime() <= now) return null;
  if (idleTimeoutMs && session.lastActivityAt && now - Number(session.lastActivityAt) > idleTimeoutMs) return null;
  const user = await User.findById(session.userId).select('_id username sessionVersion');
  if (!user || Number(session.sessionVersion || 0) !== Number(user.sessionVersion || 0)) return null;
  return user;
}
module.exports = { sessionUser };

async function establishSession(req, user) {
  const previousId = req.sessionID;
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  global.wsManager?.disconnectSession?.(previousId);
  req.session.userId = user._id.toString();
  req.session.username = user.username;
  req.session.sessionVersion = Number(user.sessionVersion || 0);
  req.session.lastActivityAt = Date.now();
}
module.exports.establishSession = establishSession;

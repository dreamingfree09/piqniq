/**
 * Session-authenticated Socket.IO manager. Client IDs are acknowledgements,
 * never credentials; both namespaces share the HTTP session store.
 */
const { Server } = require('socket.io');
const { Logger } = require('../utils/logger');
const { sessionUser } = require('../middleware/sessionIdentity');
const Post = require('../models/Post');

class WebSocketManager {
  constructor(httpServer, sessionMiddleware, { sessionIdleTimeoutMs = 0, isOriginAllowed } = {}) {
    if (typeof sessionMiddleware !== 'function') throw new Error('Socket.IO requires the HTTP session middleware');
    const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(value => value.trim()).filter(value => value && value !== '*');
    const allowed = isOriginAllowed || (origin => !origin || origins.includes(origin));
    this.io = new Server(httpServer, {
      cors: { origin: (origin, callback) => callback(null, allowed(origin)), credentials: true },
      allowRequest: (req, callback) => callback(null, allowed(req.headers.origin)),
    });
    this.io.engine.use(sessionMiddleware);
    this.connectedUsers = new Map();
    this.sessionIdleTimeoutMs = sessionIdleTimeoutMs;
    this.io.use((socket, next) => this.authenticateSocket(socket).then(() => next(), () => next(new Error('Authentication required'))));
    this.chat = this.io.of('/chat');
    this.chat.use((socket, next) => this.authenticateSocket(socket).then(() => next(), () => next(new Error('Authentication required'))));
    const guardPackets = socket => {
      socket.join('session:' + socket.request.sessionID);
      socket.join('user:' + socket.userId);
      // Reload before every event and periodically while idle: logout/reset/store
      // expiry must also revoke an already-connected socket.
      const check = () => this.authenticateSocket(socket).catch(() => socket.disconnect(true));
      socket.use((_packet, next) => this.authenticateSocket(socket).then(() => next(), () => socket.disconnect(true)));
      const timer = setInterval(check, 30000);
      timer.unref();
      socket.on('disconnect', () => clearInterval(timer));
    };
    this.io.on('connection', guardPackets);
    this.chat.on('connection', guardPackets);
    require('../chat/chatNamespace')(this.chat);
    this.init();
  }

  async authenticateSocket(socket) {
    const req = socket.request;
    if (!req.session?.userId) throw new Error('Authentication required');
    await new Promise((resolve, reject) => req.session.reload(error => error ? reject(error) : resolve()));
    const user = await sessionUser(req, this.sessionIdleTimeoutMs);
    if (!user || (socket.userId && socket.userId !== user._id.toString())) throw new Error('Authentication required');
    socket.userId = user._id.toString();
    socket.username = user.username;
  }

  init() {
    this.io.on('connection', socket => {
      if (!this.connectedUsers.has(socket.userId)) this.connectedUsers.set(socket.userId, new Set());
      this.connectedUsers.get(socket.userId).add(socket.id);
      socket.on('authenticate', userId => {
        if (typeof userId !== 'string' || userId !== socket.userId) return socket.emit('auth_error', { message: 'Authentication required' });
        socket.emit('authenticated', { success: true, userId: socket.userId });
      });
      socket.on('join-post', async postId => {
        if (typeof postId !== 'string' || !/^[a-f\d]{24}$/i.test(postId)) return;
        try {
          if (await Post.exists({ _id: postId, deletedAt: null })) socket.join('post:' + postId);
        } catch { socket.emit('auth_error', { message: 'Post temporarily unavailable' }); }
      });
      socket.on('leave-post', postId => {
        if (typeof postId === 'string' && /^[a-f\d]{24}$/i.test(postId)) socket.leave('post:' + postId);
      });
      socket.on('typing', data => {
        const postId = data?.postId;
        if (typeof postId !== 'string' || !socket.rooms.has('post:' + postId)) return;
        socket.to('post:' + postId).emit('user-typing', { username: socket.username, postId });
      });
      socket.on('disconnect', () => {
        const sockets = this.connectedUsers.get(socket.userId);
        sockets?.delete(socket.id);
        if (!sockets?.size) this.connectedUsers.delete(socket.userId);
      });
    });
  }

  disconnectSession(sessionId) {
    for (const namespace of [this.io.of('/'), this.chat]) namespace.in('session:' + sessionId).disconnectSockets();
  }
  disconnectUser(userId) {
    for (const namespace of [this.io.of('/'), this.chat]) namespace.in('user:' + userId).disconnectSockets();
  }
  sendNotification(userId, notification) {
    this.io.to('user:' + userId.toString()).emit('notification', notification);
  }
  broadcastNewPost(post) { this.io.emit('new-post', post); }
  sendPostUpdate(postId, update) { this.io.to('post:' + postId).emit('post-update', update); }
  sendLikeUpdate(postId, data) { this.io.to('post:' + postId).emit('like-update', data); }
  sendReplyNotification(postId, reply) {
    const payload = reply && typeof reply.toObject === 'function' ? reply.toObject() : reply;
    this.io.to('post:' + postId).emit('new-reply', { postId, ...payload });
  }
  getOnlineUsersCount() { return this.connectedUsers.size; }
  isUserOnline(userId) { return this.connectedUsers.has(userId.toString()); }
}
module.exports = WebSocketManager;

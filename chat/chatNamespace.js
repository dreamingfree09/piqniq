/**
 * chat/chatNamespace.js
 *
 * Socket.IO chat namespace implementation.
 *
 * Handles:
 * - Room creation/join/leave
 * - Private room invite codes / password protection
 * - Message persistence and moderation operations
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Logger } = require('../utils/logger');

const User = require('../models/User');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');

const inputText = value => typeof value === 'string' ? value.trim() : '';
const ROOM_NAME_RE = /^[a-zA-Z0-9 _-]{1,50}$/;

function generateInviteCode() {
  // URL-safe, short-ish code (Discord-ish invite vibe)
  return crypto.randomBytes(9).toString('base64url');
}

function isLikelyObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function safeRoomDTO(room, includeInviteCode = false) {
  return {
    id: room._id.toString(),
    name: room.name,
    isPrivate: !!room.isPrivate,
    createdAt: room.createdAt,
    lastActiveAt: room.lastActiveAt,
    inviteCode: includeInviteCode ? room.inviteCode : undefined
  };
}

async function resolveRoomByIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;

  if (isLikelyObjectId(identifier)) {
    return ChatRoom.findById(identifier);
  }

  // Prefer inviteCode match (private rooms)
  const byCode = await ChatRoom.findOne({ inviteCode: identifier });
  if (byCode) return byCode;

  // Fall back to name match (public rooms)
  return ChatRoom.findOne({ name: identifier });
}

module.exports = function initChatNamespace(chatNsp) {
  const connectedUsers = new Map(); // userId -> socket.id

  // Presence by room: roomId -> (socketId -> { userId, username, lastActiveAt })
  const roomPresence = new Map();
  const roomLastBroadcastAt = new Map();

  function getRoomMap(roomId) {
    const key = String(roomId || '').trim();
    if (!key) return null;
    if (!roomPresence.has(key)) roomPresence.set(key, new Map());
    return roomPresence.get(key);
  }

  function removeSocketFromRoom(roomId, socketId) {
    const map = roomPresence.get(roomId);
    if (!map) return;
    map.delete(socketId);
    if (map.size === 0) {
      roomPresence.delete(roomId);
      roomLastBroadcastAt.delete(roomId);
    }
  }

  function presencePayload(roomId) {
    const map = roomPresence.get(roomId);
    const now = Date.now();
    const activeWindowMs = 5 * 60 * 1000;

    const byUser = new Map();
    if (map) {
      for (const entry of map.values()) {
        if (!entry?.userId) continue;
        const prev = byUser.get(entry.userId);
        if (!prev || (entry.lastActiveAt || 0) > (prev.lastActiveAt || 0)) {
          byUser.set(entry.userId, entry);
        }
      }
    }

    const users = [...byUser.values()]
      .map((u) => ({
        userId: u.userId,
        username: u.username,
        lastActiveAt: u.lastActiveAt,
        active: now - (u.lastActiveAt || 0) <= activeWindowMs
      }))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return String(a.username || '').localeCompare(String(b.username || ''));
      });

    return { roomId, users };
  }

  function broadcastPresence(roomId, { throttleMs = 0 } = {}) {
    const id = String(roomId || '').trim();
    if (!id) return;

    const now = Date.now();
    const last = roomLastBroadcastAt.get(id) || 0;
    if (throttleMs && now - last < throttleMs) return;

    roomLastBroadcastAt.set(id, now);
    const roomKey = `chatroom:${id}`;
    chatNsp.to(roomKey).emit('chat:presence', presencePayload(id));
  }

  chatNsp.on('connection', (socket) => {
    Logger.info('Chat client connected', { socketId: socket.id });

    // Minimal flood control: 1 message / second per socket
    socket._chatLastMessageAt = 0;

    socket.on('chat:authenticate', (userId) => {
      if (typeof userId !== 'string' || userId !== socket.userId) {
        return socket.emit('chat:auth_error', { message: 'Authentication required.' });
      }
      connectedUsers.set(socket.userId, socket.id);
      socket.emit('chat:authenticated', { userId: socket.userId, username: socket.username });
    });

    socket.on('chat:presence_request', (payload) => {
      if (!socket.userId) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      const roomId = inputText(payload?.roomId || socket.currentChatRoomId);
      if (!isLikelyObjectId(roomId)) {
        socket.emit('chat:error', { message: 'Invalid room.' });
        return;
      }

      if (!socket.rooms.has('chatroom:' + roomId)) return socket.emit('chat:error', { message: 'Join the room first.' });
      socket.emit('chat:presence', presencePayload(roomId));
    });

    socket.on('chat:list_rooms', async () => {
      try {
        const rooms = await ChatRoom.find({ isPrivate: false })
          .sort({ lastActiveAt: -1 })
          .limit(200);

        socket.emit('chat:rooms', {
          rooms: rooms.map((r) => safeRoomDTO(r))
        });
      } catch (error) {
        socket.emit('chat:error', { message: 'Failed to load rooms.' });
      }
    });

    socket.on('chat:list_my_private_rooms', async () => {
      if (!socket.userId) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      try {
        const rooms = await ChatRoom.find({ isPrivate: true, createdBy: socket.userId })
          .sort({ lastActiveAt: -1 })
          .limit(200);

        socket.emit('chat:my_private_rooms', {
          rooms: rooms.map((r) => safeRoomDTO(r, true))
        });
      } catch (error) {
        socket.emit('chat:error', { message: 'Failed to load your private rooms.' });
      }
    });

    socket.on('chat:create_room', async (payload) => {
      if (!socket.userId) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      const name = inputText(payload?.name);
      const isPrivate = !!payload?.isPrivate;
      const password = inputText(payload?.password);

      if (!ROOM_NAME_RE.test(name)) {
        socket.emit('chat:error', {
          message: 'Room name must be 1-50 chars (letters, numbers, space, _, -).'
        });
        return;
      }

      if (password && (password.length < 4 || password.length > 128)) {
        socket.emit('chat:error', { message: 'Password must be at least 4 characters.' });
        return;
      }

      try {
        const inviteCode = isPrivate ? generateInviteCode() : undefined;
        const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;

        const room = await ChatRoom.create({
          name,
          isPrivate,
          inviteCode,
          passwordHash,
          createdBy: socket.userId,
          lastActiveAt: new Date()
        });

        socket.emit('chat:room_created', {
          room: safeRoomDTO(room, isPrivate),
          inviteCode: isPrivate ? inviteCode : null
        });

        // Refresh the creator's private room list (so they can find invite codes later)
        if (isPrivate) {
          const rooms = await ChatRoom.find({ isPrivate: true, createdBy: socket.userId })
            .sort({ lastActiveAt: -1 })
            .limit(200);
          socket.emit('chat:my_private_rooms', { rooms: rooms.map((r) => safeRoomDTO(r, true)) });
        }

        // Also refresh room list for the creator (public rooms)
        if (!isPrivate) {
          const rooms = await ChatRoom.find({ isPrivate: false })
            .sort({ lastActiveAt: -1 })
            .limit(200);
          socket.emit('chat:rooms', { rooms: rooms.map((r) => safeRoomDTO(r)) });
        }
      } catch (error) {
        if (error?.code === 11000) {
          socket.emit('chat:error', { message: 'A room with that name already exists.' });
          return;
        }
        Logger.error('Create room failed', { error: error?.message });
        socket.emit('chat:error', { message: 'Failed to create room.' });
      }
    });

    socket.on('chat:get_invite', async (payload) => {
      if (!socket.userId) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      const roomId = inputText(payload?.roomId || socket.currentChatRoomId);
      if (!isLikelyObjectId(roomId)) {
        socket.emit('chat:error', { message: 'Invalid room.' });
        return;
      }

      try {
        const room = await ChatRoom.findById(roomId).select('isPrivate inviteCode createdBy');
        if (!room) {
          socket.emit('chat:error', { message: 'Room not found.' });
          return;
        }
        if (!room.isPrivate || !room.inviteCode) {
          socket.emit('chat:error', { message: 'This room has no invite code.' });
          return;
        }
        if (!room.createdBy || room.createdBy.toString() !== socket.userId) {
          socket.emit('chat:error', { message: 'Only the room creator can view the invite code.' });
          return;
        }

        socket.emit('chat:invite', { inviteCode: room.inviteCode });
      } catch (error) {
        socket.emit('chat:error', { message: 'Failed to get invite code.' });
      }
    });

    socket.on('chat:join_room', async (payload) => {
      if (!socket.userId) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      const identifier = inputText(payload?.identifier);
      const password = inputText(payload?.password);

      try {
        const room = await resolveRoomByIdentifier(identifier);
        if (!room) {
          socket.emit('chat:error', { message: 'Room not found.' });
          return;
        }

        // Private rooms: must join by invite code (not just by name)
        if (room.isPrivate && room.inviteCode !== identifier) {
          socket.emit('chat:error', { message: 'Private rooms require an invite code.' });
          return;
        }

        if (room.passwordHash) {
          const ok = await bcrypt.compare(password, room.passwordHash);
          if (!ok) {
            socket.emit('chat:error', { message: 'Incorrect room password.' });
            return;
          }
        }

        const nextRoomId = room._id.toString();

        // Single-room UX: leave previous room when joining a new one.
        const prevRoomId = socket.currentChatRoomId;
        if (prevRoomId && prevRoomId !== nextRoomId) {
          socket.leave(`chatroom:${prevRoomId}`);
          removeSocketFromRoom(prevRoomId, socket.id);
          broadcastPresence(prevRoomId);
        }

        const roomKey = `chatroom:${nextRoomId}`;
        socket.join(roomKey);
        socket.currentChatRoomId = nextRoomId;

        // Track presence
        const map = getRoomMap(nextRoomId);
        if (map) {
          map.set(socket.id, {
            userId: socket.userId,
            username: socket.username,
            lastActiveAt: Date.now()
          });
        }

        room.lastActiveAt = new Date();
        await room.save();

        const recent = await ChatMessage.find({ room: room._id })
          .sort({ createdAt: -1 })
          .limit(100)
          .lean();
        recent.reverse();

        socket.emit('chat:joined', {
          room: safeRoomDTO(room),
          messages: recent.map((m) => ({
            id: m._id.toString(),
            roomId: m.room.toString(),
            userId: m.user.toString(),
            username: m.username,
            content: m.content,
            createdAt: m.createdAt,
            editedAt: m.editedAt || null,
            deletedAt: m.deletedAt || null
          }))
        });

        broadcastPresence(nextRoomId);
      } catch (error) {
        Logger.error('Join room failed', { error: error?.message });
        socket.emit('chat:error', { message: 'Failed to join room.' });
      }
    });

    socket.on('chat:leave_room', async (payload) => {
      const roomId = inputText(payload?.roomId);
      if (!roomId) return;
      socket.leave(`chatroom:${roomId}`);
      if (socket.currentChatRoomId === roomId) {
        socket.currentChatRoomId = null;
      }

      removeSocketFromRoom(roomId, socket.id);
      broadcastPresence(roomId);
    });

    socket.on('chat:message', async (payload) => {
      if (!socket.userId || !socket.username) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      const roomId = inputText(payload?.roomId);
      const content = inputText(payload?.content);

      const now = Date.now();
      if (socket._chatLastMessageAt && now - socket._chatLastMessageAt < 1000) {
        socket.emit('chat:error', { message: 'Slow down (1 message per second).' });
        return;
      }
      socket._chatLastMessageAt = now;

      if (!isLikelyObjectId(roomId)) {
        socket.emit('chat:error', { message: 'Invalid room.' });
        return;
      }

      if (!content) return socket.emit('chat:error', { message: 'Message cannot be empty.' });
      if (content.length > 2000) {
        socket.emit('chat:error', { message: 'Message too long.' });
        return;
      }

      try {
        const room = await ChatRoom.findById(roomId);
        if (!room) {
          socket.emit('chat:error', { message: 'Room not found.' });
          return;
        }

        // Only allow sending if socket is in that room
        const roomKey = `chatroom:${roomId}`;
        if (!socket.rooms.has(roomKey)) {
          socket.emit('chat:error', { message: 'Join the room before sending.' });
          return;
        }

        // Presence activity update (throttle broadcasts)
        const map = getRoomMap(roomId);
        if (map && map.has(socket.id)) {
          const entry = map.get(socket.id);
          entry.lastActiveAt = Date.now();
          map.set(socket.id, entry);
        }

        const message = await ChatMessage.create({
          room: room._id,
          user: socket.userId,
          username: socket.username,
          content
        });

        room.lastActiveAt = new Date();
        await room.save();

        chatNsp.to(roomKey).emit('chat:message', {
          id: message._id.toString(),
          roomId,
          userId: message.user.toString(),
          username: message.username,
          content: message.content,
          createdAt: message.createdAt
        });

        broadcastPresence(roomId, { throttleMs: 3000 });
      } catch (error) {
        Logger.error('Chat message failed', { error: error?.message });
        socket.emit('chat:error', { message: 'Failed to send message.' });
      }
    });

    socket.on('chat:message_edit', async (payload) => {
      if (!socket.userId || !socket.username) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      const messageId = String(payload?.messageId || '').trim();
      const nextContent = inputText(payload?.content);

      if (!isLikelyObjectId(messageId)) {
        socket.emit('chat:error', { message: 'Invalid message.' });
        return;
      }

      if (!nextContent) {
        socket.emit('chat:error', { message: 'Message cannot be empty.' });
        return;
      }

      if (nextContent.length > 2000) {
        socket.emit('chat:error', { message: 'Message too long.' });
        return;
      }

      try {
        const message = await ChatMessage.findById(messageId);
        if (!message) {
          socket.emit('chat:error', { message: 'Message not found.' });
          return;
        }

        const roomId = message.room.toString();
        const roomKey = `chatroom:${roomId}`;
        if (!socket.rooms.has(roomKey)) {
          socket.emit('chat:error', { message: 'Join the room first.' });
          return;
        }

        if (message.user.toString() !== socket.userId) {
          socket.emit('chat:error', { message: 'Not authorized to edit this message.' });
          return;
        }

        if (message.deletedAt) {
          socket.emit('chat:error', { message: 'Cannot edit a deleted message.' });
          return;
        }

        message.content = nextContent;
        message.editedAt = new Date();
        await message.save();

        chatNsp.to(roomKey).emit('chat:message_updated', {
          id: message._id.toString(),
          roomId,
          userId: message.user.toString(),
          username: message.username,
          content: message.content,
          createdAt: message.createdAt,
          editedAt: message.editedAt,
          deletedAt: message.deletedAt
        });
      } catch (error) {
        Logger.error('Chat message edit failed', { error: error?.message });
        socket.emit('chat:error', { message: 'Failed to edit message.' });
      }
    });

    socket.on('chat:message_delete', async (payload) => {
      if (!socket.userId || !socket.username) {
        socket.emit('chat:error', { message: 'Not authenticated.' });
        return;
      }

      const messageId = String(payload?.messageId || '').trim();
      if (!isLikelyObjectId(messageId)) {
        socket.emit('chat:error', { message: 'Invalid message.' });
        return;
      }

      try {
        const message = await ChatMessage.findById(messageId);
        if (!message) {
          socket.emit('chat:error', { message: 'Message not found.' });
          return;
        }

        const roomId = message.room.toString();
        const roomKey = `chatroom:${roomId}`;
        if (!socket.rooms.has(roomKey)) {
          socket.emit('chat:error', { message: 'Join the room first.' });
          return;
        }

        if (message.user.toString() !== socket.userId) {
          socket.emit('chat:error', { message: 'Not authorized to delete this message.' });
          return;
        }

        if (!message.deletedAt) {
          message.deletedAt = new Date();
          message.content = '[deleted]';
          await message.save();
        }

        chatNsp.to(roomKey).emit('chat:message_deleted', {
          id: message._id.toString(),
          roomId,
          userId: message.user.toString(),
          deletedAt: message.deletedAt
        });
      } catch (error) {
        Logger.error('Chat message delete failed', { error: error?.message });
        socket.emit('chat:error', { message: 'Failed to delete message.' });
      }
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        connectedUsers.delete(socket.userId);
      }

      // Remove from any room presence maps
      for (const [roomId, map] of roomPresence.entries()) {
        if (!map.has(socket.id)) continue;
        removeSocketFromRoom(roomId, socket.id);
        broadcastPresence(roomId);
      }
      Logger.info('Chat client disconnected', { socketId: socket.id });
    });
  });
};

/**
 * scripts/chat-smoke-test.js
 *
 * Socket.IO smoke test.
 *
 * Intended for quick manual validation of the chat server:
 * - Connects to the running server
 * - Creates/uses a test user
 * - Exercises basic join/send/receive flows
 *
 * Note: This is not part of `npm test` (it hits a live server).
 */
/* eslint-disable no-console */

const crypto = require('crypto');
const mongoose = require('mongoose');
const { io } = require('socket.io-client');

const User = require('../models/User');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');
const { resolveTestMongoUri } = require('../config/testDatabase');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function once(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);

    const handler = (data) => {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off(event, handler);
    }

    socket.on(event, handler);
  });
}

function waitForOneOf(socket, events, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for one of: ${events.join(', ')}`));
    }, timeoutMs);

    const handlers = new Map();

    function cleanup() {
      clearTimeout(timer);
      for (const [evt, handler] of handlers.entries()) {
        socket.off(evt, handler);
      }
    }

    for (const evt of events) {
      const handler = (data) => {
        cleanup();
        resolve({ event: evt, data });
      };
      handlers.set(evt, handler);
      socket.on(evt, handler);
    }
  });
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const mongoUri = resolveTestMongoUri();
  const origin = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.protocol !== 'http:') throw new Error('Smoke server must be loopback HTTP');

  console.log('[chat-smoke] baseUrl =', baseUrl);
  console.log('[chat-smoke] mongoUri =', mongoUri.replace(/:\/\/(.*@)/, '://'));

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const email = `chat-smoke-${nonce}@example.com`;
  const username = `chat_smoke_${nonce}`;

  const password = `pass_${nonce}_123`;
  const user = new User({
    email,
    username,
    password,
    isEmailVerified: true
  });
  await user.save();

  console.log('[chat-smoke] created user', user._id.toString());

  const login = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const cookie = login.headers.getSetCookie()[0]?.split(';')[0];
  if (!login.ok || !cookie) {
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
    throw new Error('Synthetic smoke login failed');
  }
  const socket = io(`${baseUrl}/chat`, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
    reconnection: false
  });

  try {
    await once(socket, 'connect', 5000);
    socket.emit('chat:authenticate', user._id.toString());
    await once(socket, 'chat:authenticated', 5000);

    // List rooms
    socket.emit('chat:list_rooms');
    const roomsPayload = await once(socket, 'chat:rooms', 5000);
    if (!roomsPayload || !Array.isArray(roomsPayload.rooms)) {
      throw new Error('chat:rooms payload invalid');
    }
    console.log('[chat-smoke] public rooms:', roomsPayload.rooms.length);

    // Create public room and join it
    const publicRoomName = `public_${nonce}`;
    socket.emit('chat:create_room', { name: publicRoomName, isPrivate: false, password: '' });
    const createdPublicEvt = await waitForOneOf(socket, ['chat:room_created', 'chat:error'], 5000);
    if (createdPublicEvt.event === 'chat:error') {
      throw new Error(createdPublicEvt.data?.message || 'public room create failed');
    }
    const createdPublic = createdPublicEvt.data;
    if (!createdPublic?.room?.id) throw new Error('public room creation failed');

    socket.emit('chat:join_room', { identifier: createdPublic.room.id, password: '' });
    const joinedPublic = await once(socket, 'chat:joined', 5000);
    if (joinedPublic?.room?.name !== publicRoomName) throw new Error('did not join created public room');

    // Presence should be available in the joined room
    socket.emit('chat:presence_request', { roomId: joinedPublic.room.id });
    const presence1 = await once(socket, 'chat:presence', 5000);
    if (presence1?.roomId !== joinedPublic.room.id) throw new Error('presence room mismatch');
    if (!Array.isArray(presence1?.users)) throw new Error('presence users invalid');

    // Send message
    socket.emit('chat:message', { roomId: joinedPublic.room.id, content: 'hello from smoke test' });
    const msg = await once(socket, 'chat:message', 5000);
    if (msg?.content !== 'hello from smoke test') throw new Error('message mismatch');
    if (msg?.roomId !== joinedPublic.room.id) throw new Error('message room mismatch');
    console.log('[chat-smoke] public room message OK');

    // Respect server flood control (1 msg/sec)
    await sleep(1100);

    // Create private room with password; ensure invite code returned; join by code
    const privateRoomName = `private_${nonce}`;
    const privatePassword = 'pw1234';
    socket.emit('chat:create_room', { name: privateRoomName, isPrivate: true, password: privatePassword });
    const createdPrivateEvt = await waitForOneOf(socket, ['chat:room_created', 'chat:error'], 5000);
    if (createdPrivateEvt.event === 'chat:error') {
      throw new Error(createdPrivateEvt.data?.message || 'private room create failed');
    }
    const createdPrivate = createdPrivateEvt.data;
    const inviteCode = createdPrivate?.inviteCode;
    if (!createdPrivate?.room?.id || !inviteCode) throw new Error('private room creation missing inviteCode');

    // Join by invite code (required)
    socket.emit('chat:join_room', { identifier: inviteCode, password: privatePassword });
    const joinedPrivate = await once(socket, 'chat:joined', 5000);
    if (joinedPrivate?.room?.name !== privateRoomName) throw new Error('did not join private room by code');

    socket.emit('chat:presence_request', { roomId: joinedPrivate.room.id });
    const presence2 = await once(socket, 'chat:presence', 5000);
    if (presence2?.roomId !== joinedPrivate.room.id) throw new Error('presence room mismatch (private)');

    socket.emit('chat:message', { roomId: joinedPrivate.room.id, content: 'private hello' });
    const privateMsg = await once(socket, 'chat:message', 5000);
    if (privateMsg?.content !== 'private hello') throw new Error('private message mismatch');
    console.log('[chat-smoke] private room message OK');

    // Wrong password should fail
    socket.emit('chat:join_room', { identifier: inviteCode, password: 'wrong' });
    const err = await once(socket, 'chat:error', 5000);
    if (!String(err?.message || '').toLowerCase().includes('password')) {
      throw new Error('expected incorrect password error');
    }
    console.log('[chat-smoke] wrong password rejected OK');

    console.log('[chat-smoke] PASS');
  } finally {
    try {
      socket.disconnect();
    } catch {
      // ignore
    }
    await sleep(100);
    const rooms = await ChatRoom.find({ createdBy: user._id }).select('_id');
    await ChatMessage.deleteMany({ room: { $in: rooms.map(room => room._id) } });
    await ChatRoom.deleteMany({ createdBy: user._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[chat-smoke] FAIL:', err.message);
  process.exit(1);
});

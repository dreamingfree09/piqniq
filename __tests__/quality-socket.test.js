/** Socket.IO regressions against a real loopback server and disposable users. */
const http = require('http');
const mongoose = require('mongoose');
const request = require('supertest');
const { io } = require('socket.io-client');
const app = require('../app');
const WebSocketManager = require('../config/websocket');
const User = require('../models/User');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');
let server, manager, base, owner, victim, cookie;
const clients = [];
const ownedIds = [];
const rooms = [];
function event(socket, names, ms = 1200) {
  return new Promise(resolve => {
    let timer;
    const handlers = names.map(name => [name, payload => { cleanup(); resolve({ name, payload }); }]);
    function cleanup() { clearTimeout(timer); for (const [name, fn] of handlers) socket.off(name, fn); }
    for (const [name, fn] of handlers) socket.once(name, fn);
    timer = setTimeout(() => { cleanup(); resolve({ name: 'timeout' }); }, ms);
  });
}
function connect(namespace = '/chat', signedCookie) {
  const socket = io(base + namespace, { transports: ['websocket'], reconnection: false, autoConnect: false, extraHeaders: signedCookie ? { Cookie: signedCookie } : {} });
  clients.push(socket);
  return socket;
}
beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const nonce = Date.now().toString(36);
  const agent = request.agent(app);
  const register = await agent.post('/api/auth/register').send({ username: 'qs_' + nonce, email: 'qs_' + nonce + '@example.invalid', password: 'Quality1234!' });
  expect(register.status).toBe(201);
  owner = register.body.user;
  cookie = register.headers['set-cookie'][0].split(';')[0];
  victim = await User.create({ username: 'qv_' + nonce, email: 'qv_' + nonce + '@example.invalid', password: 'Quality1234!' });
  ownedIds.push(owner.id, victim._id);
  server = http.createServer(app);
  manager = new WebSocketManager(server, app.locals.sessionMiddleware, { sessionIdleTimeoutMs: 60000 });
  global.wsManager = manager;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
afterAll(async () => {
  for (const client of clients) client.disconnect();
  if (manager) await new Promise(resolve => manager.io.close(resolve));
  delete global.wsManager;
  await ChatMessage.deleteMany({ room: { $in: rooms } });
  await ChatRoom.deleteMany({ _id: { $in: rooms } });
  await User.deleteMany({ _id: { $in: ownedIds } });
  await mongoose.disconnect();
});
test.each(['', '/chat'])('namespace %s rejects anonymous connections even with a supplied user ID', async namespace => {
  const socket = connect(namespace);
  socket.auth = { userId: victim._id.toString() };
  const result = event(socket, ['connect', 'connect_error']);
  socket.connect();
  expect((await result).name).toBe('connect_error');
});
test('authenticated chat cannot change identity to another user', async () => {
  const socket = connect('/chat', cookie);
  const connected = event(socket, ['connect', 'connect_error']); socket.connect();
  expect((await connected).name).toBe('connect');
  const result = event(socket, ['chat:authenticated', 'chat:auth_error']);
  socket.emit('chat:authenticate', victim._id.toString());
  expect((await result).name).toBe('chat:auth_error');
});
test('private room requires its invite, persists a message under the session principal and rejects malformed payloads', async () => {
  const socket = connect('/chat', cookie);
  const connected = event(socket, ['connect', 'connect_error']); socket.connect(); expect((await connected).name).toBe('connect');
  const authenticated = event(socket, ['chat:authenticated', 'chat:auth_error']); socket.emit('chat:authenticate', owner.id);
  expect((await authenticated).name).toBe('chat:authenticated');
  const room = await ChatRoom.create({ name: 'qs-private-' + Date.now(), createdBy: owner.id, isPrivate: true, inviteCode: 'quality-invite' });
  rooms.push(room._id);
  const rejected = event(socket, ['chat:error', 'chat:joined']); socket.emit('chat:join_room', { identifier: room._id.toString() });
  expect((await rejected).name).toBe('chat:error');
  const joined = event(socket, ['chat:error', 'chat:joined']); socket.emit('chat:join_room', { identifier: room.inviteCode });
  expect((await joined).name).toBe('chat:joined');
  const presence = event(socket, ['chat:presence', 'chat:error']); socket.emit('chat:presence_request', { roomId: room._id.toString() });
  expect((await presence).name).toBe('chat:presence');

  const sent = event(socket, ['chat:message', 'chat:error']); socket.emit('chat:message', { roomId: room._id.toString(), content: 'Synthetic chat content' });
  expect((await sent).name).toBe('chat:message');
  expect((await ChatMessage.findOne({ room: room._id })).user.toString()).toBe(owner.id);
  const message = await ChatMessage.findOne({ room: room._id });
  const edited = event(socket, ['chat:message_updated', 'chat:error']); socket.emit('chat:message_edit', { messageId: message._id.toString(), content: 'Edited synthetic content' });
  expect((await edited).name).toBe('chat:message_updated');

  const invalid = event(socket, ['chat:error', 'chat:room_created']); socket.emit('chat:create_room', { name: { invalid: true } });
  expect((await invalid).name).toBe('chat:error');
});
test('root namespace cannot subscribe to another user notifications', async () => {
  const socket = connect('', cookie);
  const connected = event(socket, ['connect', 'connect_error']); socket.connect(); expect((await connected).name).toBe('connect');
  const result = event(socket, ['authenticated', 'auth_error']); socket.emit('authenticate', victim._id.toString());
  expect((await result).name).toBe('auth_error');
});
test('session rotation immediately disconnects sockets tied to the previous cookie', async () => {
  const agent = request.agent(app);
  const username = 'qr_' + Date.now().toString(36);
  const email = username + '@example.invalid';
  const registered = await agent.post('/api/auth/register').send({ username, email, password: 'Quality1234!' });
  ownedIds.push(registered.body.user.id);
  const oldCookie = registered.headers['set-cookie'][0].split(';')[0];
  const socket = connect('', oldCookie);
  const connected = event(socket, ['connect', 'connect_error']); socket.connect(); expect((await connected).name).toBe('connect');
  const disconnected = event(socket, ['disconnect']);
  expect((await agent.post('/api/auth/login').send({ email, password: 'Quality1234!' })).status).toBe(200);
  expect((await disconnected).name).toBe('disconnect');
});
test('logout disconnects both namespaces and prevents further authenticated events', async () => {
  const socket = connect('/chat', cookie);
  const connected = event(socket, ['connect', 'connect_error']); socket.connect(); expect((await connected).name).toBe('connect');
  const disconnected = event(socket, ['disconnect']);
  expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(200);
  socket.emit('chat:list_rooms');
  expect((await disconnected).name).toBe('disconnect');
});

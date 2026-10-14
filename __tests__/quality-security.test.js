/**
 * Quality closeout regressions. All database records and uploads are synthetic.
 * Test database selection is supplied by the isolated runner, never a .env file.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const app = require('../app');
const User = require('../models/User');
const Post = require('../models/Post');
const ChatRoom = require('../models/ChatRoom');
const ChatUpload = require('../models/ChatUpload');

const ids = [];
const postIds = [];
const roomIds = [];
const uploaded = [];
let sequence = 0;
const nonce = Date.now().toString(36);
async function account() {
  const username = `qa_${nonce}_${++sequence}`;
  const email = `${username}@example.invalid`;
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({ username, email, password: 'Quality1234!' });
  expect(response.status).toBe(201);
  ids.push(response.body.user.id);
  return { agent, userId: response.body.user.id, username, email, cookie: response.headers['set-cookie'][0].split(';')[0] };
}
function rememberUpload(response) {
  const url = response.body.imageUrl || response.body.avatarUrl;
  if (url) uploaded.push(path.join(__dirname, '..', 'public', url));
}

beforeAll(async () => mongoose.connect(process.env.MONGODB_URI));
afterAll(async () => {
  await Post.deleteMany({ _id: { $in: postIds } });
  const chatFiles = await ChatUpload.find({ room: { $in: roomIds } });
  for (const file of chatFiles) fs.rmSync(path.join(__dirname, '..', 'uploads', 'chat', path.basename(file.storedName)), { force: true });
  await ChatUpload.deleteMany({ room: { $in: roomIds } });
  await ChatRoom.deleteMany({ _id: { $in: roomIds } });
  await User.deleteMany({ _id: { $in: ids } });
  for (const file of uploaded) {
    const root = path.resolve(__dirname, '..', 'public', 'uploads') + path.sep;
    if (!path.resolve(file).startsWith(root)) throw new Error('Fixture cleanup outside upload root');
    fs.rmSync(file, { force: true });
  }
  await mongoose.disconnect();
});

test('password reset produces a usable password, consumes the token and revokes old sessions', async () => {
  const a = await account();
  await User.updateOne({ _id: a.userId }, { passwordResetToken: 'quality-reset-token', passwordResetExpires: new Date(Date.now() + 60000) });
  const reset = await request(app).post('/api/email/reset-password/quality-reset-token').send({ password: 'Corrected9876!' });
  expect(reset.status).toBe(200);
  const login = await request(app).post('/api/auth/login').send({ email: a.email, password: 'Corrected9876!' });
  expect(login.status).toBe(200);
  expect((await a.agent.get('/api/portfolio/me')).status).toBe(401);
  expect((await request(app).post('/api/email/reset-password/quality-reset-token').send({ password: 'Another9876!' })).status).toBe(400);
});
test('login rotates the session ID and invalidates the previous cookie', async () => {
  const a = await account();
  const login = await a.agent.post('/api/auth/login').send({ email: a.email, password: 'Quality1234!' });
  expect(login.status).toBe(200);
  const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
  expect(cookie).toBeDefined();
  expect(cookie).not.toBe(a.cookie);
  expect((await request(app).get('/api/auth/me').set('Cookie', a.cookie)).status).toBe(401);
});
test('account anonymisation revokes a second previously authenticated session', async () => {
  const a = await account();
  const second = request.agent(app);
  expect((await second.post('/api/auth/login').send({ email: a.email, password: 'Quality1234!' })).status).toBe(200);
  expect((await a.agent.delete('/api/profile/me').send({ confirmUsername: a.username })).status).toBe(200);
  expect((await second.get('/api/portfolio/me')).status).toBe(401);
});
test('me and profile update responses never expose verification/reset credentials', async () => {
  const a = await account();
  await User.updateOne({ _id: a.userId }, { emailVerificationToken: 'private-verification', passwordResetToken: 'private-reset' });
  for (const response of [
    await a.agent.get('/api/auth/me'),
    await a.agent.put('/api/profile/update').send({ bio: 'Synthetic biography' }),
  ]) {
    expect(response.status).toBe(200);
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('emailVerificationToken');
    expect(response.body.user).not.toHaveProperty('passwordResetToken');
  }
});
test('profile update accepts uploaded avatar paths and empty optional social links', async () => {
  const a = await account();
  const response = await a.agent.put('/api/profile/update').send({
    avatar: '/uploads/avatars/synthetic.png', socialLinks: { github: '', linkedin: '', twitter: '', website: '' },
  });
  expect(response.status).toBe(200);
  expect(response.body.user.avatar).toBe('/uploads/avatars/synthetic.png');
});
test('profile rejects a spoofed social hostname and executable avatar scheme', async () => {
  const a = await account();
  expect((await a.agent.put('/api/profile/update').send({ socialLinks: { github: 'https://example.invalid/?github.com' } })).status).toBe(400);
  expect((await a.agent.put('/api/profile/update').send({ avatar: 'javascript:alert(1)' })).status).toBe(400);
});
test.each(['fake.jpg.html', 'fake.jpg'])('media upload rejects non-image bytes named %s', async filename => {
  const a = await account();
  const response = await a.agent.post('/api/upload/post-image').attach('image', Buffer.from('<script>window.bad=true</script>'), { filename, contentType: 'image/jpeg' });
  rememberUpload(response);
  expect(response.status).toBe(400);
});
test('valid raster upload succeeds and another user cannot delete it', async () => {
  const a = await account();
  const b = await account();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer();
  const response = await a.agent.post('/api/upload/avatar').attach('avatar', png, { filename: 'synthetic.png', contentType: 'image/png' });
  rememberUpload(response);
  expect(response.status).toBe(200);
  expect((await b.agent.delete('/api/upload/delete').send({ filePath: response.body.avatarUrl })).status).toBe(403);
  expect((await a.agent.delete('/api/upload/delete').send({ filePath: '/../outside.txt' })).status).toBe(400);
  expect((await a.agent.delete('/api/upload/delete').send({ filePath: response.body.avatarUrl })).status).toBe(200);
});
test('private chat uploads reject a user who has not joined the room', async () => {
  const owner = await account();
  const outsider = await account();
  const room = await ChatRoom.create({ name: `qa-private-${nonce}`, isPrivate: true, createdBy: owner.userId, inviteCode: 'quality-private-invite' });
  roomIds.push(room._id);
  const response = await outsider.agent.post('/api/chat/uploads').field('roomId', room._id.toString()).attach('file', Buffer.from('synthetic'), { filename: 'synthetic.txt', contentType: 'text/plain' });
  expect(response.status).toBe(403);
});
test('chat upload rejects active SVG content', async () => {
  const a = await account();
  const response = await a.agent.post('/api/chat/uploads').field('roomId', new mongoose.Types.ObjectId().toString()).attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>'), { filename: 'active.svg', contentType: 'image/svg+xml' });
  expect(response.status).toBe(400);
});
test('malformed JSON is a client error without reflecting input', async () => {
  const response = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"password":"synthetic-private-value",');
  expect(response.status).toBe(400);
  expect(response.body.error).toBe('Invalid JSON body');
  expect(JSON.stringify(response.body)).not.toContain('synthetic-private-value');
});
test('forum search treats regex metacharacters as literal text and bounds pagination', async () => {
  expect((await request(app).get('/api/posts').query({ search: '[' })).status).toBe(200);
  const response = await request(app).get('/api/posts').query({ page: -3, limit: -10 });
  expect(response.status).toBe(200);
  expect(response.body.currentPage).toBe(1);
});
test('soft-deleted posts remain absent from profiles, feeds and metadata', async () => {
  const author = await account();
  const reader = await account();
  const post = await Post.create({ author: author.userId, title: 'Deleted synthetic post', content: 'Synthetic deleted content', category: 'general', deletedAt: new Date() });
  postIds.push(post._id);
  await User.updateOne({ _id: reader.userId }, { following: [author.userId] });
  const profile = await request(app).get('/api/profile/' + author.username);
  expect(profile.status).toBe(200);
  expect(profile.body.posts.some(p => p._id === post._id.toString())).toBe(false);
  expect((await reader.agent.get('/api/social/feed')).body.some(p => p._id === post._id.toString())).toBe(false);
  expect((await request(app).get('/api/system/meta/post/' + post._id)).status).toBe(404);
});

test('sitemap is usable with real users and links to existing post routes', async () => {
  const a = await account();
  const post = await Post.create({ author: a.userId, title: 'Synthetic sitemap post', content: 'Synthetic content for sitemap', category: 'general' });
  postIds.push(post._id);
  const response = await request(app).get('/api/system/sitemap.xml');
  expect(response.status).toBe(200);
  expect(response.text).toContain('/post/' + post._id);
  expect(response.text).not.toContain('undefined');
});
test('invalid post ID and oversized search return client errors', async () => {
  expect((await request(app).get('/api/posts/not-an-id')).status).toBe(400);
  expect((await request(app).get('/api/posts').query({ search: 'x'.repeat(201) })).status).toBe(400);
});

test('non-string login password is a client error', async () => {
  expect((await request(app).post('/api/auth/login').send({ email: 'synthetic@example.invalid', password: { unexpected: true } })).status).toBe(400);
});
test('an authenticated reader can like an existing post', async () => {
  const author = await account();
  const reader = await account();
  const post = await Post.create({ author: author.userId, title: 'Synthetic like post', content: 'Synthetic content for likes', category: 'general' });
  postIds.push(post._id);
  const response = await reader.agent.post('/api/posts/' + post._id + '/like');
  expect(response.status).toBe(200);
  expect((await Post.findById(post._id)).likes.map(String)).toContain(reader.userId);
});
test('permissioned staff rejects fake PDF bytes and unpermissioned readers cannot upload resources', async () => {
  const staff = await account();
  const reader = await account();
  const Role = require('../models/Role');
  const role = await Role.create({ name: 'QualityPDF' + nonce, permissions: ['resources:create'] });
  try {
    await User.updateOne({ _id: staff.userId }, { roles: [role._id] });
    expect((await staff.agent.post('/api/resources/pdf').attach('file', Buffer.from('<html>synthetic</html>'), { filename: 'fake.pdf', contentType: 'application/pdf' })).status).toBe(400);
    expect((await reader.agent.post('/api/resources/pdf').attach('file', Buffer.from('%PDF-1.7 synthetic'), { filename: 'fixture.pdf', contentType: 'application/pdf' })).status).toBe(403);
  } finally { await Role.deleteOne({ _id: role._id }); }
});

test('concurrent password resets consume the token only once', async () => {
  const a = await account();
  const token = 'quality-reset-race-' + nonce;
  await User.updateOne({ _id: a.userId }, { passwordResetToken: token, passwordResetExpires: new Date(Date.now() + 60000) });
  const responses = await Promise.all(['RaceFirst9876!', 'RaceSecond9876!'].map(password => request(app).post('/api/email/reset-password/' + token).send({ password })));
  expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
});
test('concurrent verification consumes the token only once', async () => {
  const a = await account();
  const token = 'quality-verify-race-' + nonce;
  await User.updateOne({ _id: a.userId }, { isEmailVerified: false, emailVerificationToken: token, emailVerificationExpires: new Date(Date.now() + 60000) });
  const responses = await Promise.all([request(app).get('/api/email/verify/' + token), request(app).get('/api/email/verify/' + token)]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
});

test('reset validation errors do not echo a supplied password', async () => {
  const supplied = 'private-synthetic-password';
  const response = await request(app).post('/api/email/reset-password/unknown-token').send({ password: supplied });
  expect(response.status).toBe(400);
  expect(JSON.stringify(response.body)).not.toContain(supplied);
});

test.each(['StrongPassword123!' + 'x'.repeat(60), 'StrongPassword123!' + 'é'.repeat(30)])('new credentials reject bcrypt byte truncation without echoing the value', async password => {
  const response = await request(app).post('/api/auth/register').send({ username: 'long_' + nonce + (++sequence), email: 'long' + sequence + '@example.invalid', password });
  expect(response.status).toBe(400);
  expect(JSON.stringify(response.body)).not.toContain(password);
  const reset = await request(app).post('/api/email/reset-password/unknown-token').send({ password });
  expect(reset.status).toBe(400);
  expect(JSON.stringify(reset.body)).not.toContain(password);
});

test('analytics placeholder does not log arbitrary client secrets or raw network identifiers', async () => {
  const sentinel = 'private-synthetic-analytics';
  const response = await request(app).post('/api/system/analytics/track').send({ event: sentinel, data: { password: sentinel } });
  expect(response.status).toBe(200);
  const line = fs.readFileSync(path.join(__dirname, '..', 'logs', 'app.log'), 'utf8').trim().split('\n').pop();
  expect(line).not.toContain(sentinel);
  expect(line).not.toContain('userAgent');
  expect(line).not.toContain('127.0.0.1');
});

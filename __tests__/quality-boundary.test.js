const { resolveTestMongoUri } = require('../config/testDatabase');
const { errorHandler } = require('../middleware/errorHandler');
test.each([
  {},
  { MONGODB_URI_TEST: 'mongodb://127.0.0.1:59321/piqniq' },
  { MONGODB_URI_TEST: 'mongodb://remote.invalid:59321/piqniq-test-run', PIQNIQ_TEST_DB_ACK: 'piqniq-test-run' },
  { MONGODB_URI_TEST: 'mongodb://127.0.0.1:59321/piqniq-test-run', PIQNIQ_TEST_DB_ACK: 'different' },
  { MONGODB_URI_TEST: 'mongodb://127.0.0.1:59321/piqniq-test-run?replicaSet=shared', PIQNIQ_TEST_DB_ACK: 'piqniq-test-run' },
])('test DB selection rejects unsafe or unacknowledged configuration %#', env => {
  expect(() => resolveTestMongoUri(env)).toThrow(/explicit loopback/);
});
test('test DB accepts only an explicitly acknowledged local run database', () => {
  const uri = 'mongodb://127.0.0.1:59321/piqniq-test-disposable';
  expect(resolveTestMongoUri({ MONGODB_URI_TEST: uri, PIQNIQ_TEST_DB_ACK: 'piqniq-test-disposable' })).toBe(uri);
});
test('unhandled server errors never return their internal message', () => {
  let status, payload;
  const response = { headersSent: false, status: code => { status = code; return response; }, json: value => { payload = value; } };
  errorHandler(new Error('Synthetic internal database credential detail'), { method: 'GET', path: '/synthetic' }, response, () => {});
  expect(status).toBe(500);
  expect(payload.error).toBe('Internal Server Error');
});

test('all email helpers skip SMTP in the test runtime', async () => {
  const nodemailer = require('nodemailer');
  const transport = jest.spyOn(nodemailer, 'createTransport');
  const email = require('../utils/email');
  const user = { email: 'synthetic@example.invalid' };
  for (const result of [await email.sendVerificationEmail(user, 'synthetic'), await email.sendPasswordResetEmail(user, 'synthetic'), await email.sendNotificationEmail(user, { message: 'synthetic' })]) {
    expect(result.messageId).toBe('skipped-test-runtime');
  }
  expect(transport).not.toHaveBeenCalled();
});
test('compound credential fields and verification URLs are redacted from logger metadata', () => {
  const fs = require('fs'); const path = require('path');
  const { Logger } = require('../utils/logger');
  const sentinel = 'synthetic-secret-sentinel';
  Logger.info('Quality privacy sentinel', { passwordResetToken: sentinel, emailVerificationToken: sentinel, verificationUrl: 'https://example.invalid/?token=' + sentinel });
  const line = fs.readFileSync(path.join(__dirname, '..', 'logs', 'app.log'), 'utf8').trim().split('\n').pop();
  expect(line).not.toContain(sentinel);
  expect(line).toContain('[REDACTED]');
});

test('access logs redact token-bearing path capabilities', () => {
  const { safeRequestPath } = require('../utils/privacy');
  for (const path of ['/api/email/verify/private-synthetic-token', '/api/email/reset-password/private-synthetic-token', '/share/card/private-synthetic-token/data', '/api/chat/uploads/private-synthetic-token.png']) {
    expect(safeRequestPath({ path })).not.toContain('private-synthetic-token');
  }
});

test('default test runner binds Supertest listeners to loopback and blocks external sockets', async () => {
  const http = require('http'); const net = require('net');
  const server = http.createServer();
  server.listen(0);
  expect(server.address().address).toBe('127.0.0.1');
  await new Promise(resolve => server.close(resolve));
  const socket = new net.Socket();
  expect(() => socket.connect({ host: 'external.invalid', port: 80 })).toThrow(/outbound connection blocked/i);
  socket.destroy();
});
test('configuration salt is loaded before logger privacy snapshots it', () => {
  const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawnSync } = require('child_process');
  const root = path.resolve(__dirname, '..');
  const results = ['alpha-fixture', 'beta-fixture'].map(salt => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'piqniq-salt-test-'));
    try {
      fs.writeFileSync(path.join(folder, '.env'), 'PII_HASH_SALT=' + salt);
      const env = { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'test' };
      delete env.PII_HASH_SALT; delete env.LOG_IP_SALT;
      const code = 'require(' + JSON.stringify(path.join(root, 'app.js')) + '); console.log(require(' + JSON.stringify(path.join(root, 'utils/privacy.js')) + ').hashIp("127.0.0.1"));process.exit(0)';
      const child = spawnSync(process.execPath, ['-e', code], { cwd: folder, env, encoding: 'utf8', timeout: 8000 });
      expect(child.status).toBe(0);
      return child.stdout.trim();
    } finally {
      if (path.dirname(folder) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('piqniq-salt-test-')) throw new Error('Salt fixture cleanup boundary mismatch');
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
  expect(results[0]).not.toBe(results[1]);
});

test('development responses also omit internal exception stacks', () => {
  const before = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  let payload; const response = { headersSent: false, status: () => response, json: value => { payload = value; } };
  try { errorHandler(new Error('Synthetic internal exception'), { method: 'GET', path: '/synthetic' }, response, () => {}); }
  finally { process.env.NODE_ENV = before; }
  expect(payload).not.toHaveProperty('stack');
  expect(payload.error).toBe('Internal Server Error');
});

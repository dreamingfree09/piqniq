/** Exercise the production client code with inert DOM fixtures (not a browser). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
test('public profile renders biography/legacy attributes as text and blocks executable URLs', () => {
  const mount = { innerHTML: '' };
  const context = {
    document: { addEventListener() {}, getElementById: () => mount },
    window: { location: { origin: 'https://piqniq.invalid' } }, URL, console,
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js/profile.js'), 'utf8');
  const Profile = vm.runInNewContext(source + '\nProfileManager;', context);
  const renderer = Object.create(Profile.prototype);
  renderer.escapeHtml = escape;
  renderer.renderProfile({
    user: { username: 'synthetic', avatar: 'javascript:alert(1)', bio: '<img src=x onerror=alert(1)>', createdAt: new Date(), reputation: 0, badges: [], socialLinks: { github: 'javascript:alert(2)' } },
    stats: { totalPosts: 0, totalLikes: 0 }, posts: [],
  });
  expect(mount.innerHTML).toContain('&lt;img');
  expect(mount.innerHTML).not.toContain('src="javascript:');
  expect(mount.innerHTML).not.toContain('href="javascript:');
  expect(mount.innerHTML).toContain('/images/default-avatar.png');
});
test.each([
  ['//example.invalid', null],
  ['/\\example.invalid', null],
  ['/\n/example.invalid', null],
  ['/study?tab=todo#today', '/study?tab=todo#today'],
])('login return path %j stays on the application origin', (raw, expected) => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/auth.js'), 'utf8');
  const start = source.indexOf('  const getSafeNextUrl = () => {');
  const end = source.indexOf('\n  };', start);
  expect(start).toBeGreaterThan(0);
  const body = source.slice(start, end + 5);
  const actual = vm.runInNewContext(body + '\ngetSafeNextUrl();', {
    window: { location: { search: '?next=' + encodeURIComponent(raw), origin: 'https://piqniq.invalid' } },
    URL, URLSearchParams,
  });
  expect(actual).toBe(expected);
});

test('existing static chat UI check recognises the same-origin dynamic loader', () => {
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, ['scripts/chat-ui-sanity.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('[chat-ui-sanity] PASS');
});

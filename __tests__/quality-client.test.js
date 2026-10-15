/** Exercise the production client code with inert DOM fixtures (not a browser). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

/** Parse the actual production HTML/helper with a real DOM; no encoder substitutes. */
function profileFixture() {
  const dom = new JSDOM('<div id="profileContainer"></div><div id="dashboardContainer"></div>', {
    url: 'https://piqniq.invalid/', runScripts: 'outside-only',
  });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../public/js/profile.js'), 'utf8') + '\nwindow.TestProfile = ProfileManager;');
  const renderer = new dom.window.TestProfile();
  // Exclude asynchronous dashboard API work, not production rendering or encoding.
  renderer.attachDashboardEventListeners = jest.fn();
  renderer.loadDashboardExtras = jest.fn();
  return { dom, renderer, document: dom.window.document };
}

test('public profile renders biography/legacy attributes as text and blocks executable URLs', () => {
  const { dom, renderer, document } = profileFixture();
  try {
    const username = 'synthetic" onerror="window.qualityXss=true';
    const bio = '<img src=x onerror=alert(1)>';
    renderer.renderProfile({
      user: { username, avatar: 'javascript:alert(1)', bio, createdAt: new Date(), reputation: 0, badges: [], socialLinks: { github: 'javascript:alert(2)' } },
      stats: { totalPosts: 0, totalLikes: 0 }, posts: [],
    });
    expect(document.querySelector('.profile-bio').textContent).toBe(bio);
    expect(document.querySelector('.profile-bio img')).toBeNull();
    const avatar = document.querySelector('.profile-avatar img');
    expect(avatar.getAttribute('src')).toBe('/images/default-avatar.png');
    expect(avatar.getAttribute('alt')).toBe(username);
    expect(avatar.getAttributeNames().sort()).toEqual(['alt', 'src']);
    expect(document.querySelector('[src^="javascript:"], [href^="javascript:"], [onerror]')).toBeNull();
  } finally { dom.window.close(); }
});

test.each(['github', 'linkedin', 'twitter'])('dashboard preserves hostile legacy %s as one input value', field => {
  const { dom, renderer, document } = profileFixture();
  try {
    const hostile = '\" autofocus onfocus=\"window.qualityXss=true\"><img src=x onerror=\"window.qualityXss=true\">';
    const bio = '</textarea><img src=x onerror="window.qualityXss=true"> & biography';
    renderer.renderDashboard({
      user: { username: 'synthetic', reputation: 0, badges: [], bio, socialLinks: { [field]: hostile } },
      myPosts: [], notifications: [],
    });
    const form = document.querySelector('#profileEditForm');
    const input = form.querySelector(`[name="${field}"]`);
    expect(input.value).toBe(hostile);
    expect(input.getAttributeNames().sort()).toEqual(['name', 'placeholder', 'type', 'value']);
    expect(form.querySelectorAll('input')).toHaveLength(3);
    expect(form.querySelectorAll('textarea')).toHaveLength(1);
    expect(form.querySelector('[autofocus], [onfocus], [onerror], img, script')).toBeNull();
    expect(form.querySelector('[name="bio"]').value).toBe(bio);
    expect(dom.window.qualityXss).toBeUndefined();
  } finally { dom.window.close(); }
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

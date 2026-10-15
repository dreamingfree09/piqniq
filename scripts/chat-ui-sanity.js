/**
 * scripts/chat-ui-sanity.js
 *
 * Static sanity check for chat UI wiring.
 *
 * Reads `public/livechat.html` and `public/js/chat.js` and verifies:
 * - All element IDs referenced by chat.js exist in the HTML
 * - The HTML includes required script tags (socket.io + chat.js)
 */
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function main() {
  const root = path.join(__dirname, '..');
  const htmlPath = path.join(root, 'public', 'livechat.html');
  const jsPath = path.join(root, 'public', 'js', 'chat.js');

  const html = read(htmlPath);
  const js = read(jsPath);

  const idMatches = [...js.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  const ids = [...new Set(idMatches)].sort();

  const missing = [];
  for (const id of ids) {
    const needle = `id=\"${id}\"`;
    const needle2 = `id='${id}'`;
    if (!html.includes(needle) && !html.includes(needle2)) {
      missing.push(id);
    }
  }

  const requiredIncludes = [
    '/socket.io/socket.io.js',
    '/js/chat.js'
  ];

  // chat.js lazily loads the same-origin client after authentication.
  const dynamicSocketLoader = js.includes("script.src = '/socket.io/socket.io.js'") || js.includes('script.src = "/socket.io/socket.io.js"');
  const missingIncludes = requiredIncludes.filter((source) =>
    !html.includes(source) && !(source === '/socket.io/socket.io.js' && dynamicSocketLoader));

  if (missing.length || missingIncludes.length) {
    console.error('[chat-ui-sanity] FAIL');
    if (missing.length) {
      console.error('Missing element IDs in livechat.html:', missing);
    }
    if (missingIncludes.length) {
      console.error('Missing script includes in livechat.html:', missingIncludes);
    }
    process.exit(1);
  }

  console.log('[chat-ui-sanity] PASS:', ids.length, 'IDs found + scripts present');
}

main();

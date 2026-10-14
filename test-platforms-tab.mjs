import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, script, styles] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./platforms-tab.js', import.meta.url), 'utf8'),
  readFile(new URL('./platforms-tab.css', import.meta.url), 'utf8'),
]);

assert.match(html, /platforms-tab\.css/);
assert.match(html, /platforms-tab\.js/);
assert.match(script, /Plataformas/);
assert.match(script, /LeiaSP/);
assert.match(script, /const WORKER_URL = 'https:\/\/sdf\.gabrielreplit56\.workers\.dev'/);
assert.match(script, /WORKER_URL}\/leiasp\/login/);
assert.match(script, /form\.method = 'POST'/);
assert.match(script, /input\.name = 'token_sed'/);
assert.match(script, /currentSession\?\.token2/);
assert.match(script, /fallbackInput\.name = 'token_sed_alt'/);
assert.match(script, /function browserFingerprint\(\)/);
assert.match(script, /sec_ch_ua_mobile/);
assert.match(script, /sec_ch_ua_platform/);
assert.match(script, /form\.target = '_blank'/);
assert.match(script, /session\(\)/);
assert.match(styles, /\.sedx-platforms-overlay/);
assert.match(styles, /repeat\(8, minmax\(0, 1fr\)\)/);
assert.match(styles, /prefers-reduced-motion/);

console.log('OK: a aba Plataformas carrega e o LeiaSP usa POST com a sessão SED, menu mobile e movimento reduzido.');

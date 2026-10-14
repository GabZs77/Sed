import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, script, styles] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./platforms-tab.js', import.meta.url), 'utf8'),
  readFile(new URL('./platforms-tab.css', import.meta.url), 'utf8'),
]);

assert.match(html, /platforms-tab\.css/);
assert.match(html, /platforms-tab\.js/);
assert.match(script, /Ferramentas/);
assert.doesNotMatch(script, /LeiaSP|leiasp|WORKER_URL|token_sed/);
assert.match(script, /const TAB_VALUE = 'ferramentas'/);
assert.match(script, /const LEGACY_TAB_VALUE = 'plataformas'/);
assert.match(script, /function isToolsTab\(\)/);
assert.match(script, /data-sedx-platform-link/);
assert.match(script, /data-platforms-close/);
assert.match(styles, /\.sedx-platforms-overlay/);
assert.match(styles, /\.tools-empty-state/);
assert.match(styles, /repeat\(8, minmax\(0, 1fr\)\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.doesNotMatch(styles, /leiasp/i);

console.log('OK: Ferramentas permanece na navegação e em links legados; LeiaSP e sua integração foram removidos.');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, navigationStyles, toolsScript, toolsStyles] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./mobile-navigation.css', import.meta.url), 'utf8'),
  readFile(new URL('./tools-tab.js', import.meta.url), 'utf8'),
  readFile(new URL('./tools-tab.css', import.meta.url), 'utf8'),
]);

assert.match(html, /mobile-navigation\.css/);
assert.match(navigationStyles, /\.bottom-nav\s*\{\s*display:\s*none\s*!important/s);
assert.match(navigationStyles, /\.page-content\s*\{\s*padding-bottom:\s*24px\s*!important/s);
assert.match(toolsScript, /\.side-rail \.rail-nav/);
assert.doesNotMatch(toolsScript, /\.bottom-nav|sedx-tools-bottom-link/);
assert.match(toolsStyles, /\.sedx-tools-overlay \{ inset: 70px 0 0 0; \}/);
assert.doesNotMatch(toolsStyles, /sedx-tools-bottom-link|bottom-nav:has/);

console.log('OK: navegação inferior removida; menu lateral e acesso às Ferramentas preservados.');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const module = fs.readFileSync(new URL('./site-state.js', import.meta.url), 'utf8');
assert.ok(html.includes('./site-state.js'));
assert.ok(module.includes("'/site-state'"));
assert.ok(module.includes('notifications'));
assert.ok(module.includes('/site-state'));
assert.ok(module.includes('O SedX está em manutenção'));
assert.ok(module.includes('/admin'));
assert.ok(module.includes('/admin-tab'));
assert.ok(module.includes("!document.querySelector('[data-admin-backdrop]')"));
assert.ok(module.includes('sedx-notification-button'));
console.log('OK: fluxo público de notificações, manutenção e exceção das rotas administrativas presente.');

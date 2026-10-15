import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, script, styles, schema] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./tools-tab.js', import.meta.url), 'utf8'),
  readFile(new URL('./tools-tab.css', import.meta.url), 'utf8'),
  readFile(new URL('./sedx-admin-schema.sql', import.meta.url), 'utf8'),
]);

assert.match(html, /tools-tab\.css/);
assert.match(html, /tools-tab\.js/);
assert.match(script, /Ferramentas/);
assert.match(script, /TAB_VALUE = 'ferramentas'/);
assert.match(script, /ADMIN_RAS/);
assert.match(script, /data-tools-publish/);
assert.match(script, /Nova ferramenta/);
assert.match(script, /name="title"/);
assert.match(script, /name="description"/);
assert.match(script, /name="content"/);
assert.match(script, /name="imageFile" type="file"/);
assert.match(script, /value="copy"/);
assert.match(script, /value="site"/);
assert.match(script, /\$\{WORKER_URL\}\/admin\/tools/);
assert.match(script, /\$\{WORKER_URL\}\/site-state/);
assert.match(script, /Apenas administradores podem publicar/);
assert.match(script, /MAX_IMAGE_BYTES = 250 \* 1024/);
assert.match(script, /validSiteUrl/);
assert.doesNotMatch(script, /token_sed|browserFingerprint|LeiaSP|Plataformas/i);
assert.match(styles, /\.tools-publish-modal/);
assert.match(styles, /\.tools-card-grid/);
assert.doesNotMatch(styles, /bottom-nav|sedx-tools-bottom-link/);
assert.match(styles, /prefers-reduced-motion/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS published_tools/);
assert.match(schema, /action_type TEXT NOT NULL CHECK \(action_type IN \('copy', 'site'\)\)/);

console.log('OK: Ferramentas publica conteúdo apenas para admins, oferece imagem opcional e ações Copiar/site com persistência D1.');

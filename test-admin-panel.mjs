import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('./admin-panel.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');

assert.ok(html.includes('./admin-panel.js'), 'O módulo administrativo deve ser carregado.');
assert.ok(admin.includes("'1127620514'"), 'O primeiro RA autorizado deve existir.');
assert.ok(admin.includes("'1127241606'"), 'O segundo RA autorizado deve existir.');
assert.ok(admin.includes('Administração'), 'A aba administrativa deve existir.');
for (const feature of ['Gerenciamento de usuários', 'Avisos e notificações', 'Configurações do site', 'Logs e auditoria', 'Ferramentas de manutenção']) {
  assert.ok(admin.includes(feature), `A funcionalidade ${feature} deve estar disponível.`);
}
assert.ok(admin.includes("localStorage.getItem('sed_sessao')"), 'A autorização deve usar a sessão atual.');
assert.ok(admin.includes("history.pushState({}, '', '/admin-tab')"), 'Abrir a administração deve atualizar a rota para /admin-tab.');
assert.ok(admin.includes("window.location.assign('/admin-tab')"), 'O clique na aba deve navegar de verdade para /admin-tab.');
assert.ok(admin.includes("headers.set('X-Admin-User', session.usuario || '')"), 'A API administrativa deve receber o identificador completo da sessão.');
assert.ok(css.includes('.sedx-admin-panel'), 'O painel deve ter estilos próprios.');
console.log('OK: painel administrativo autorizado por RA e recursos principais presentes.');

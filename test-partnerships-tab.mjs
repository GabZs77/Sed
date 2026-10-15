import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const controller = read('./partnerships-tab.js');
const styles = read('./partnerships-tab.css');
const html = read('./index.html');
const schema = read('./sedx-admin-schema.sql');
const readme = read('./README.md');
const tools = read('./tools-tab.js');

assert.match(html, /partnerships-tab\.css/, 'o CSS da aba deve ser carregado');
assert.match(html, /partnerships-tab\.js/, 'o controlador da aba deve ser carregado');
assert.match(controller, /data-sedx-partnerships-link/, 'a aba deve entrar na navegação lateral');
assert.match(controller, /<span>Parcerias<\/span>/, 'a navegação deve exibir o nome Parcerias');
assert.match(controller, /insertBefore\(link,\s*aboutLink\)/, 'Parcerias deve ficar imediatamente acima de Sobre');
assert.match(controller, /partnership-handshake-icon/, 'a aba deve usar um ícone de handshake');

const adminRas = (source) => {
  const match = source.match(/ADMIN_RAS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  return match ? [...match[1].matchAll(/["'](\d+)["']/g)].map((item) => item[1]).sort() : [];
};
assert.deepEqual(adminRas(controller), adminRas(tools), 'a visibilidade do botão deve reutilizar a lista de administradores do SedX');
assert.match(controller, /isAdmin\(\) \? '<button[^']*data-partnership-publish/, 'o botão Publicar principal deve existir somente para administradores');
assert.match(controller, /function adminHeaders/, 'as ações administrativas devem enviar cabeçalhos de sessão');
assert.match(controller, /X-Admin-User/, 'o Worker deve receber a identidade administrativa');
assert.match(controller, /X-Token2/, 'o Worker deve receber o token da sessão usado na autorização');

for (const field of ['title', 'description', 'logoFile', 'bannerFile', 'destinationUrl', 'type']) {
  assert.ok(controller.includes(`name="${field}"`), `o modal deve incluir o campo ${field}`);
}
for (const type of ['Discord', 'WhatsApp', 'Outro']) {
  assert.ok(controller.includes(type), `o seletor deve oferecer ${type}`);
}
assert.match(controller, /data-partnership-preview/, 'a interface deve permitir pré-visualizar antes de publicar');
assert.match(controller, /REVISÃO ANTES DE PUBLICAR/, 'a confirmação de prévia deve ser clara');
assert.match(controller, /Publicar parceria/, 'a publicação deve ser uma ação explícita após a prévia');
assert.match(controller, /data-partnership-save-draft/, 'o administrador deve poder salvar um rascunho');
assert.match(controller, /data-partnership-toggle/, 'os cartões administrativos devem permitir publicar/despublicar');
assert.match(controller, /data-partnership-edit/, 'os cartões administrativos devem permitir editar');
assert.match(controller, /window\.confirm\(/, 'a exclusão deve pedir confirmação');
assert.match(controller, /data-partnership-delete/, 'os cartões administrativos devem permitir excluir');
assert.match(controller, /role.*alert|setAttribute\('role', kind === 'error' \? 'alert'/, 'os erros devem ser anunciados acessivelmente');
assert.match(controller, /Parceria publicada com sucesso/, 'a interface deve mostrar sucesso de publicação');
assert.match(controller, /Não foi possível salvar a parceria/, 'a interface deve mostrar erro de salvamento');
assert.match(controller, /\/partnerships/, 'a aba deve ler parcerias públicas');
assert.match(controller, /\/admin\/partnerships/, 'a aba deve usar operações administrativas protegidas');
assert.match(controller, /\/admin\/partnerships\/status/, 'a aba deve usar a rota dedicada de publicação/despublicação');
assert.match(styles, /@media \(max-width: 760px\)/, 'a aba deve ter layout móvel');
assert.match(schema, /CREATE TABLE IF NOT EXISTS published_partnerships/, 'o schema deve definir a tabela D1 das parcerias');
assert.match(schema, /partnership_type IN \('Discord', 'WhatsApp', 'Outro'\)/, 'o schema deve restringir os tipos aceitos');
assert.match(schema, /is_published INTEGER NOT NULL DEFAULT 0/, 'novas parcerias devem iniciar como rascunho');
assert.match(schema, /idx_published_partnerships_status/, 'o schema deve indexar listagem por publicação');
assert.match(readme, /## Parcerias/, 'o README deve documentar a aba');

console.log('Testes da aba Parcerias: OK');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const html = read('index.html');
const ui = read('site-state.js');
const worker = read('service-worker.js');
const styles = read('push-notifications.css');

assert.ok(html.includes('./push-notifications.css'), 'A folha de estilos push deve ser carregada.');
assert.ok(ui.includes('data-sedx-push-toggle'), 'A central deve exibir um controle ativar/desativar.');
assert.ok(ui.includes("Notification.requestPermission()"), 'A permissão deve ser solicitada após ação do usuário.');
assert.ok(ui.includes("'/push/subscribe'"), 'A inscrição deve ser sincronizada com o Worker.');
assert.ok(ui.includes("'/push/unsubscribe'"), 'A desativação deve remover o endpoint no Worker.');
assert.ok(ui.includes("'/service-worker.js'"), 'A inscrição deve registrar o service worker.');
assert.ok(worker.includes("self.addEventListener('push'"), 'O service worker deve exibir notificações recebidas.');
assert.ok(worker.includes("self.addEventListener('notificationclick'"), 'O clique deve abrir a página relacionada.');
assert.ok(styles.includes(':focus-visible'), 'O botão deve ter estado de foco acessível.');
assert.ok(styles.includes('@media (max-width: 520px)'), 'O controle deve se adaptar a telas estreitas.');
console.log('OK: interface de consentimento e service worker de notificações push.');

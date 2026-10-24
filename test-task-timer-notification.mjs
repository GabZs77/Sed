import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const helper = read("task-timer-notification.js");
const bundle = read("script.js");
const html = read("index.html");

assert.ok(html.indexOf('task-timer-notification.js') < html.indexOf('type="module" src="./script.js'), "O helper deve carregar antes do app");
assert.ok(bundle.includes("window.sedxNotifyTaskTimer(timer,body)"), "O vencimento do contador deve chamar o helper de notificação");
assert.ok(!bundle.includes('new Notification("Tempo da tarefa concluído"'), "O contador não deve usar Notification diretamente no app");

const calls = { shown: [], registered: [], native: [] };
const registration = {
  async showNotification(title, options) { calls.shown.push({ title, options }); },
};
const context = {
  window: { focus() {} },
  Notification: class {
    static permission = "granted";
    constructor(title, options) { calls.native.push({ title, options }); }
    close() {}
  },
  navigator: {
    serviceWorker: {
      async getRegistration(scope) { assert.equal(scope, "/"); return registration; },
      async register(path, options) { calls.registered.push({ path, options }); return registration; },
    },
  },
};
vm.runInNewContext(helper, context);
const body = "O tempo de 3 minutos terminou. Volte à atividade para revisar e enviar.";
assert.equal(await context.window.sedxNotifyTaskTimer({ taskId: "tarefa-42" }, body), true);
assert.equal(calls.shown.length, 1, "A notificação deve ser exibida pelo service worker");
assert.equal(calls.shown[0].title, "Tempo da tarefa concluído");
assert.equal(calls.shown[0].options.body, body);
assert.equal(calls.shown[0].options.tag, "sed-task-tarefa-42");
assert.equal(calls.shown[0].options.data.url, "/tarefas");
assert.equal(calls.native.length, 0, "Não deve criar notificação de página se o service worker funcionou");

const deniedContext = {
  window: {},
  Notification: class { static permission = "denied"; },
  navigator: { serviceWorker: { async getRegistration() { throw new Error("não deveria acessar o service worker"); } } },
};
vm.runInNewContext(helper, deniedContext);
assert.equal(await deniedContext.window.sedxNotifyTaskTimer({ taskId: "x" }, body), false, "Não deve exibir quando a permissão foi negada");

const fallbackCalls = [];
const fallbackContext = {
  window: { focus() {} },
  Notification: class {
    static permission = "granted";
    constructor(title, options) { fallbackCalls.push({ title, options }); }
    close() {}
  },
  navigator: {},
};
vm.runInNewContext(helper, fallbackContext);
assert.equal(await fallbackContext.window.sedxNotifyTaskTimer({ taskId: "fallback" }, body), true);
assert.equal(fallbackCalls.length, 1, "Deve preservar o fallback em navegadores sem service worker");

console.log("OK: o fim do timer chama o service worker para exibir uma notificação de sistema sem duplicar o aviso visual.");

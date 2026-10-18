import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const start = source.indexOf("function readSession(){");
const end = source.indexOf("function firstName(", start);
assert.ok(start >= 0 && end > start, "client request helpers should be present");

class MemoryStorage {
  constructor(initial) { this.values = new Map(Object.entries(initial || {})); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Worker-Build": "test" } });

function createClient(fetchMock) {
  const localStorage = new MemoryStorage({ sed_sessao: JSON.stringify({ usuario: "ra-test", token: "old-sed-token", token2: "old-api-token", cdUsuarioCurto: "123" }) });
  const context = { localStorage, Headers, fetch: fetchMock, WORKER_URL: "https://worker.test", SESSION_KEY: "sed_sessao", URLSearchParams };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.fetchDashboard=fetchDashboard;this.fetchOptional=fetchOptional;this.resumeSession=resumeSession;`, context);
  return { context, localStorage };
}

const calls = [];
let dashboardCalls = 0;
const dashboardClient = createClient(async (url, init = {}) => {
  const path = new URL(url).pathname;
  calls.push({ path, init });
  if (path === "/resume") return jsonResponse({ token: "renewed-sed-token", token2: "renewed-api-token", cdUsuarioCurto: "123" });
  if (path === "/dashboard") {
    dashboardCalls += 1;
    return jsonResponse({ tarefas: [{ id: "task" }], meta: { alunoApiOk: true, faltasApiOk: dashboardCalls > 1, agendaApiOk: dashboardCalls > 1 } });
  }
  throw new Error(`Unexpected path ${path}`);
});
const dashboard = await dashboardClient.context.fetchDashboard();
assert.equal(dashboardCalls, 2, "partial dashboard should be retried once after resuming the session");
assert.deepEqual(calls.map(call => call.path), ["/dashboard", "/resume", "/dashboard"]);
const secondDashboard = calls.at(-1);
assert.equal(new Headers(secondDashboard.init.headers).get("X-Token"), "renewed-sed-token");
assert.equal(new Headers(secondDashboard.init.headers).get("X-Token2"), "renewed-api-token");
const saved = JSON.parse(dashboardClient.localStorage.getItem("sed_sessao"));
assert.equal(saved.token, "renewed-sed-token");
assert.equal(saved.token2, "renewed-api-token");

const optionalCalls = [];
const optionalClient = createClient(async (url, init = {}) => {
  const path = new URL(url).pathname;
  optionalCalls.push({ path, init });
  if (path === "/boletim" && optionalCalls.filter(call => call.path === "/boletim").length === 1) return jsonResponse({ erro: "sessão expirada" }, 403);
  if (path === "/resume") return jsonResponse({ token: "new-sed", token2: "new-api", cdUsuarioCurto: "123" });
  if (path === "/boletim") return jsonResponse({ ok: true, data: [{ nota: 8 }] });
  throw new Error(`Unexpected path ${path}`);
});
const grades = await optionalClient.context.fetchOptional("/boletim");
assert.equal(grades.ok, true);
assert.deepEqual(optionalCalls.map(call => call.path), ["/boletim", "/resume", "/boletim"]);
assert.equal(new Headers(optionalCalls.at(-1).init.headers).get("X-Token2"), "new-api");

console.log("OK: consultas do painel e boletim renovam sessão expirada e repetem a chamada uma única vez.");

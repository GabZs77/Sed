import assert from "node:assert/strict";
import worker from "./redacao-worker.mjs";

const origin = "https://sed-gg.vercel.app";
const noOrigin = await worker.fetch(new Request("https://sdf-redacoes.example/essays"));
assert.equal(noOrigin.status, 403);

const options = await worker.fetch(new Request("https://sdf-redacoes.example/essays", {
  method: "OPTIONS",
  headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-api-key,accept" },
}));
assert.equal(options.status, 204);
assert.equal(options.headers.get("Access-Control-Allow-Origin"), origin);
assert.match(options.headers.get("Access-Control-Allow-Headers"), /X-Api-Key/i);

const missingKey = await worker.fetch(new Request("https://sdf-redacoes.example/essays", { headers: { Origin: origin } }));
assert.equal(missingKey.status, 401);

let captured;
globalThis.fetch = async (url, init) => {
  captured = { url: new URL(url), init };
  return new Response(JSON.stringify([{ id: 7, is_essay: true }]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
const response = await worker.fetch(new Request("https://sdf-redacoes.example/essays?limit=500&offset=-5", {
  headers: { Origin: origin, "X-Api-Key": "runtime-session-token" },
}));
assert.equal(response.status, 200);
assert.equal(response.headers.get("Cache-Control"), "no-store");
assert.equal(captured.url.hostname, "edusp-api.ip.tv");
assert.equal(captured.url.pathname, "/tms/task/todo");
assert.equal(captured.url.searchParams.get("limit"), "100", "O limite deve ser limitado a 100");
assert.equal(captured.url.searchParams.get("offset"), "0", "Offsets negativos devem ser corrigidos");
assert.equal(captured.url.searchParams.get("is_essay"), "true");
assert.deepEqual(captured.url.searchParams.getAll("answer_statuses"), ["draft", "pending"]);
assert.equal(captured.init.headers["X-Api-Key"], "runtime-session-token");
const body = await response.json();
assert.equal(body[0].id, 7);
console.log("OK: Worker de redações limita a rota, aplica CORS do Sed e encaminha a sessão sem persistência.");

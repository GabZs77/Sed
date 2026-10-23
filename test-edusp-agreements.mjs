import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const handler = require("./api/edusp-agreements.js");
const tokenPayload = Buffer.from(JSON.stringify({ nick: "student-test" })).toString("base64url");
const apiKey = `header.${tokenPayload}.signature`;
const pendingAnswer = {
  id: 246237821,
  task_id: 104126068,
  status: "finished",
  pending_agreement: true,
  answers: {
    485462885: {
      question_id: 485462885,
      pending_agreement: true,
      ia_validation: { revision_status: "finished", validation: "Comentário de teste que não deve sair para o navegador." },
    },
    485462886: {
      question_id: 485462886,
      pending_agreement: true,
      ia_validation: { revision_status: "finished", validation: "Outro comentário de teste." },
    },
  },
};
const otherTask = {
  id: 777,
  task_id: 104126069,
  status: "finished",
  pending_agreement: true,
  answers: {
    888: { question_id: 888, pending_agreement: true, ia_validation: { revision_status: "finished", validation: "Outra tarefa." } },
  },
};
let calls = [];
let upstreamRows = [pendingAnswer, otherTask];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  calls.push({ url, method: options.method || "GET", headers: options.headers || {}, body: options.body });
  if (url.pathname === "/room/user") {
    return new Response(JSON.stringify({ rooms: [{ id: "room-A", group_categories: [{ id: "group-1" }] }] }), { status: 200 });
  }
  if (url.pathname === "/tms/answer") {
    assert.equal(url.searchParams.get("nick"), "student-test");
    assert.equal(url.searchParams.get("task_is_exam"), "false");
    assert.equal(url.searchParams.get("task_is_essay"), "false");
    return new Response(JSON.stringify(upstreamRows), { status: 200 });
  }
  if (url.pathname.startsWith("/tms/task/") && url.pathname.endsWith("/agreement")) {
    assert.equal(options.method, "PUT");
    assert.deepEqual(JSON.parse(options.body), { agreed: true });
    assert.equal(options.headers["X-Api-Key"], apiKey);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  throw new Error(`Rota upstream inesperada: ${url.pathname}`);
};
function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; },
    end() { return this; },
  };
}
async function invoke(body, headers = { "x-api-key": apiKey }) {
  const res = makeResponse();
  await handler({ method: "POST", headers, url: "/api/edusp-agreements", body }, res);
  return res;
}

let response = await invoke({ taskId: "104126068", agreed: true });
assert.equal(response.statusCode, 200);
assert.deepEqual(
  { ok: response.payload.ok, taskId: response.payload.taskId, total: response.payload.total, confirmed: response.payload.confirmed, failed: response.payload.failed },
  { ok: true, taskId: "104126068", total: 2, confirmed: 2, failed: 0 },
);
const puts = calls.filter(call => call.method === "PUT");
assert.equal(puts.length, 2);
assert.deepEqual(puts.map(call => call.url.pathname).sort(), [
  "/tms/task/104126068/question/485462885/answer/246237821/agreement",
  "/tms/task/104126068/question/485462886/answer/246237821/agreement",
].sort());
assert.equal(JSON.stringify(response.payload).includes("Comentário de teste"), false, "não devolver o texto da correção ao navegador");
assert.ok(calls.some(call => call.url.pathname === "/room/user"));
assert.ok(calls.some(call => call.url.pathname === "/tms/answer"));

calls = [];
upstreamRows = [otherTask];
response = await invoke({ taskId: "104126068", agreed: true });
assert.equal(response.statusCode, 200, "não encontrar comentário pendente não desfaz o envio da atividade");
assert.equal(response.payload.pending, false);
assert.equal(response.payload.confirmed, 0);
assert.equal(calls.some(call => call.method === "PUT"), false, "não enviar agreement para outra atividade");

calls = [];
response = await invoke({ taskId: "104126068", agreed: false });
assert.equal(response.statusCode, 400);
assert.equal(calls.length, 0, "não chamar o upstream sem agreed=true");
response = await invoke({ taskId: "104126068", agreed: true }, {});
assert.equal(response.statusCode, 400, "exigir sessão do aluno");
console.log("OK: após o envio, IDs pendentes são consultados por atividade e cada PUT envia apenas { agreed: true }.");

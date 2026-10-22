import assert from "node:assert/strict";
import { handleGroqChat, handleGroqHelp, handleGroqResearch } from "./groq-worker.mjs";

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  const request = JSON.parse(init.body);
  calls.push({ url, headers: init.headers, request });
  const content = request.response_format?.type === "json_object"
    ? '{"selected_ids":["op-b"]}'
    : "Resposta de teste do Flash IA.";
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

try {
  const env = { GROQ_API_KEY: "test-only-key" };
  const auth = { "Content-Type": "application/json", "X-Token2": "session-token" };
  const taskPrompt = "Resolva a questão escolar abaixo.\n\nResponda SOMENTE com um objeto JSON válido, sem Markdown.\n\nFormato exato: {\"selected_ids\":[\"id_exato\"]}\n\nDados da questão: alternativa op-b.";
  const selection = await handleGroqChat(new Request("https://worker.test/groq-chat", {
    method: "POST", headers: auth, body: JSON.stringify({ messages: [{ role: "user", content: taskPrompt }] }),
  }), env);
  assert.equal(selection.status, 200);
  assert.deepEqual(await selection.json(), { response: '{"selected_ids":["op-b"]}' });
  assert.equal(calls[0].request.model, "openai/gpt-oss-120b");
  assert.deepEqual(calls[0].request.response_format, { type: "json_object" });
  assert.equal(calls[0].request.messages[0].role, "system");
  assert.match(calls[0].request.messages[0].content, /respostas abertas\/dissertativas/);
  assert.match(calls[0].request.messages[0].content, /causa e consequência/);
  assert.match(calls[0].request.messages[0].content, /não invente fatos/);
  assert.equal(calls[0].headers.Authorization, "Bearer test-only-key");

  const chat = await handleGroqChat(new Request("https://worker.test/groq-chat", {
    method: "POST", headers: auth,
    body: JSON.stringify({ messages: [{ role: "system", content: "Você é o Flash IA." }, { role: "user", content: "Explique fotossíntese." }] }),
  }), env);
  assert.deepEqual(await chat.json(), { response: "Resposta de teste do Flash IA." });
  assert.equal("response_format" in calls[1].request, false, "O tutor não deve ser forçado a responder em JSON.");

  for (const handler of [handleGroqHelp, handleGroqResearch]) {
    const response = await handler(new Request("https://worker.test/groq", {
      method: "POST", headers: auth, body: JSON.stringify({ messages: [{ role: "user", content: "Ajude com a matéria." }] }),
    }), env);
    assert.equal(response.status, 200);
  }

  const noSession = await handleGroqChat(new Request("https://worker.test/groq-chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "Oi" }] }),
  }), env);
  assert.equal(noSession.status, 401);

  const noSecret = await handleGroqChat(new Request("https://worker.test/groq-chat", {
    method: "POST", headers: auth, body: JSON.stringify({ messages: [{ role: "user", content: "Oi" }] }),
  }), {});
  assert.equal(noSecret.status, 503);

  const invalid = await handleGroqChat(new Request("https://worker.test/groq-chat", {
    method: "POST", headers: auth, body: "not-json",
  }), env);
  assert.equal(invalid.status, 400);
  console.log("OK: handlers Groq autenticados, modelo ativo, JSON para seleção e texto livre para tutor.");
} finally {
  globalThis.fetch = originalFetch;
}

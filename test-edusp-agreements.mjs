import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handler = require("./api/edusp-agreements.js");
const tokenPayload = Buffer.from(JSON.stringify({ nick: "student-test" })).toString("base64url");
const apiKey = `header.${tokenPayload}.signature`;
const pendingAnswer = {
  id: 100,
  task_id: 200,
  pending_agreement: true,
  answers: {
    300: { question_id: 300, answer: "private answer", ia_validation: { revision_status: "finished" } },
    301: { question_id: 301, answer: "not pending", answer_pending_agreement: false },
  },
};
const notPendingAnswer = { id: 101, task_id: 201, pending_agreement: false, answers: { 302: { question_id: 302, ia_validation: { revision_status: "finished" } } } };
let calls = [];
let mode = "normal";

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  calls.push({ url, method: options.method || "GET", headers: options.headers || {}, body: options.body });
  if (url.pathname === "/room/user") {
    return new Response(JSON.stringify({ rooms: [{ name: "target-A", group_categories: [{ id: "group-1" }] }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/tms/answer") {
    assert.equal(url.searchParams.get("nick"), "student-test");
    assert.equal(url.searchParams.get("limit"), "20");
    assert.deepEqual(url.searchParams.getAll("publication_target"), ["target-A", "group-1"]);
    return new Response(JSON.stringify([pendingAnswer, notPendingAnswer]), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/tms/task/200/question/300/answer/100/agreement") {
    assert.equal(options.method, "PUT");
    assert.equal(JSON.parse(options.body).agreed, true);
    assert.equal(options.headers["X-Api-Key"], apiKey);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unexpected upstream path ${url.pathname}`);
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
async function invoke(method, body, headers = { "x-api-key": apiKey }, url = "/api/edusp-agreements") {
  const res = makeResponse();
  await handler({ method, headers, url, body }, res);
  return res;
}

let response = await invoke("GET");
assert.equal(response.statusCode, 200);
assert.equal(response.payload.total, 1);
assert.deepEqual(response.payload.corrections[0], { taskId: "200", questionId: "300", answerId: "100", title: "", revisedAt: "" });
assert.equal(JSON.stringify(response.payload).includes("private answer"), false, "The API must not return a student's answer text");
assert.equal(calls[0].headers["X-Api-Key"], apiKey);

calls = [];
response = await invoke("PUT", { agreed: true, corrections: [{ taskId: "200", questionId: "300", answerId: "100" }] });
assert.equal(response.statusCode, 200);
assert.equal(response.payload.confirmed, 1);
assert.equal(response.payload.failed, 0);
const put = calls.find(call => call.method === "PUT");
assert.ok(put);
assert.equal(put.url.pathname, "/tms/task/200/question/300/answer/100/agreement");
assert.equal(put.body, JSON.stringify({ agreed: true }));

calls = [];
response = await invoke("PUT", { agreed: true, corrections: [{ taskId: "999", questionId: "300", answerId: "100" }] });
assert.equal(response.statusCode, 409, "IDs that are no longer pending must be rejected before any PUT");
assert.equal(calls.some(call => call.method === "PUT"), false);

response = await invoke("PUT", { agreed: false, corrections: [{ taskId: "200", questionId: "300", answerId: "100" }] });
assert.equal(response.statusCode, 400, "The explicit agreement flag must be true");
response = await invoke("GET", undefined, {});
assert.equal(response.statusCode, 400, "A session key is required");

console.log("OK: pending agreements are filtered, private answer data is omitted, and only freshly pending IDs receive PUT { agreed: true }.");

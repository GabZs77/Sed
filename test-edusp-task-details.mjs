import assert from "node:assert/strict";
import handler from "./api/edusp-task-details.js";

function fakeResponse() {
  return {
    headers: {},
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    json(body) { this.body = body; this.finished = true; return this; },
    send(body) { this.body = body; this.finished = true; return this; },
    end() { this.finished = true; return this; },
  };
}

function req({ method = "GET", url = "/api/edusp-task-details?task_id=task-42&room_name=r7f4d52c5663e5d500-l", headers = {} } = {}) {
  return { method, url, headers };
}

const originalFetch = global.fetch;
try {
  let requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response('{"questions":[{"id":"q1"}]}', {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  };

  const success = fakeResponse();
  await handler(req({ headers: {
    origin: "https://sed-gg.vercel.app",
    "x-api-key": "test-student-api-key",
    "x-captcha-token": "test-captcha-token",
    "x-captcha-session": "test-session-key",
    "x-captcha-cookie": "sid=temporary; aux=temporary2",
  } }), success);

  assert.equal(success.statusCode, 200);
  assert.equal(success.headers["cache-control"], "no-store");
  assert.equal(success.headers["x-task-proxy"], "vercel-gru1");
  assert.deepEqual(JSON.parse(success.body), { questions: [{ id: "q1" }] });
  assert.equal(requests.length, 1, "um CAPTCHA deve originar somente uma chamada de apply");
  const sent = requests[0];
  const upstream = new URL(sent.url);
  assert.equal(upstream.origin, "https://edusp-api.ip.tv");
  assert.equal(upstream.pathname, "/tms/task/task-42/apply");
  assert.equal(upstream.searchParams.get("preview_mode"), "false");
  assert.equal(upstream.searchParams.get("token_code"), "null");
  assert.equal(upstream.searchParams.get("room_name"), "r7f4d52c5663e5d500-l");
  assert.equal(sent.options.method, "GET");
  const headers = new Headers(sent.options.headers);
  assert.equal(headers.get("x-api-key"), "test-student-api-key");
  assert.equal(headers.get("x-captcha-token"), "test-captcha-token");
  assert.equal(headers.get("x-session-key"), "test-session-key");
  assert.equal(headers.get("cookie"), "sid=temporary; aux=temporary2");
  assert.equal(headers.get("x-api-platform"), "webclient");
  assert.equal(headers.get("x-api-realm"), "edusp");

  requests = [];
  const missingApiKey = fakeResponse();
  await handler(req({ headers: { "x-captcha-token": "test-captcha-token" } }), missingApiKey);
  assert.equal(missingApiKey.statusCode, 400);
  assert.equal(requests.length, 0);

  const missingCaptcha = fakeResponse();
  await handler(req({ headers: { "x-api-key": "test-student-api-key" } }), missingCaptcha);
  assert.equal(missingCaptcha.statusCode, 428);
  assert.equal(requests.length, 0);

  const badTask = fakeResponse();
  await handler(req({ url: "/api/edusp-task-details?task_id=..%2Fother&room_name=room", headers: {
    "x-api-key": "test-student-api-key", "x-captcha-token": "test-captcha-token",
  } }), badTask);
  assert.equal(badTask.statusCode, 400);
  assert.equal(requests.length, 0);

  const badOrigin = fakeResponse();
  await handler(req({ headers: { origin: "https://attacker.example", "x-api-key": "test-student-api-key", "x-captcha-token": "test-captcha-token" } }), badOrigin);
  assert.equal(badOrigin.statusCode, 403);
  assert.equal(requests.length, 0);

  const wrongMethod = fakeResponse();
  await handler(req({ method: "POST", headers: { "x-api-key": "test-student-api-key", "x-captcha-token": "test-captcha-token" } }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(requests.length, 0);

  global.fetch = async () => new Response('{"error":"sensitive upstream content"}', {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
  const rejected = fakeResponse();
  await handler(req({ headers: {
    "x-api-key": "test-student-api-key",
    "x-captcha-token": "test-captcha-token",
    "x-captcha-cookie": "must-not-be-echoed",
  } }), rejected);
  assert.equal(rejected.statusCode, 401);
  assert.equal(rejected.body.upstream_status, 401);
  assert.match(rejected.body.erro, /HTTP 401/);
  assert.doesNotMatch(JSON.stringify(rejected.body), /test-student-api-key|test-captcha-token|must-not-be-echoed|sensitive upstream content/);

  console.log("Vercel task-details proxy tests passed");
} finally {
  global.fetch = originalFetch;
}

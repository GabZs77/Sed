import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handler = require("./api/edusp-captcha.js");
const originalFetch = globalThis.fetch;
const upstreamCalls = [];
let expectedSessionKey = "";

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
  };
}

function makeRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { this.body = ""; return this; },
  };
}

try {
  globalThis.fetch = async (url, options) => {
    upstreamCalls.push({ url, options });
    if (url.endsWith("/captcha/challenge")) {
      assert.equal(options.headers["x-session-key"].length, 32);
      assert.equal(options.headers["x-api-key"], "student-api-key-test");
      expectedSessionKey = options.headers["x-session-key"];
      assert.deepEqual(JSON.parse(options.body), { type: "image" });
      return response(200, {
        challengeId: "challenge-1",
        challenge: { image: "AA==" },
      }, { "content-type": "application/json" });
    }
    assert.equal(url, "https://edusp-api.ip.tv/captcha/verify");
    assert.equal(options.headers["x-session-key"], expectedSessionKey);
    assert.equal(options.headers["x-api-key"], "student-api-key-test");
    assert.equal(options.headers.Cookie, "captcha_sid=one; captcha_aux=two");
    assert.deepEqual(JSON.parse(options.body), { challengeId: "challenge-1", answer: "mUL3H" });
    return response(200, { valid: true, token: "captcha-token" }, { "content-type": "application/json" });
  };

  const challengeReq = {
    method: "POST",
    headers: { "x-api-key": "student-api-key-test", origin: "https://sed-gg.vercel.app" },
    body: { action: "challenge", type: "image" },
  };
  const challengeRes = makeRes();
  await handler(challengeReq, challengeRes);
  assert.equal(challengeRes.statusCode, 200);
  const challenge = JSON.parse(challengeRes.body);
  assert.equal(challenge.sessionKey.length, 32, "o proxy deve criar uma sessionKey estável para o desafio");
  assert.equal(challenge.challengeId, "challenge-1");

  const verifyReq = {
    method: "POST",
    headers: { "x-api-key": "student-api-key-test", origin: "https://sed-gg.vercel.app" },
    body: {
      action: "verify",
      sessionKey: challenge.sessionKey,
      captchaCookie: "captcha_sid=one; captcha_aux=two",
      payload: { challengeId: "challenge-1", answer: "mUL3H" },
    },
  };
  const verifyRes = makeRes();
  await handler(verifyReq, verifyRes);
  assert.equal(verifyRes.statusCode, 200);
  const verified = JSON.parse(verifyRes.body);
  assert.equal(verified.token, "captcha-token");
  assert.equal(verified.sessionKey, challenge.sessionKey);
  assert.equal(verified.captchaCookie, "captcha_sid=one; captcha_aux=two");
  assert.equal(upstreamCalls.length, 2);

  const unauthorizedRes = makeRes();
  await handler({ method: "POST", headers: {}, body: { action: "challenge" } }, unauthorizedRes);
  assert.equal(unauthorizedRes.statusCode, 400);
  assert.match(unauthorizedRes.body.erro, /Sessão EduSP/);

  console.log("test-edusp-captcha-proxy: desafio e validação usam a mesma sessionKey e o mesmo egress Vercel.");
} finally {
  globalThis.fetch = originalFetch;
}

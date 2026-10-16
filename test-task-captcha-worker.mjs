import assert from "node:assert/strict";
import worker from "./task-captcha-worker.mjs";

const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const headers = new Headers(init.headers);
  calls.push({ url, init, headers });
  if (url.pathname === "/captcha/challenge") {
    assert.equal(init.method, "POST");
    assert.equal(headers.get("x-session-key")?.length, 32);
    assert.equal(headers.get("x-api-key"), null);
    assert.deepEqual(JSON.parse(init.body), { realm: "edusp", type: "image" });
    return new Response(JSON.stringify({ challenge_id: "challenge-1", image: "data:image/png;base64,AA==" }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": "captcha_sid=challenge; Path=/; HttpOnly" },
    });
  }
  if (url.pathname === "/captcha/verify") {
    const body = JSON.parse(init.body);
    assert.equal(body.payload.challengeId, "challenge-1");
    assert.equal(body.payload.answer, "Pc7jg");
    assert.equal(headers.get("x-session-key")?.length, 32);
    assert.equal(headers.get("cookie"), "captcha_sid=challenge");
    assert.equal(headers.get("x-api-key"), null);
    return new Response(JSON.stringify({ captcha_token: "captcha-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": "captcha_aux=verified; Path=/; HttpOnly" },
    });
  }
  if (url.pathname === "/tms/task/task-1/apply") {
    assert.equal(init.method, "GET");
    assert.equal(url.searchParams.get("preview_mode"), "false");
    assert.equal(url.searchParams.get("token_code"), "null");
    assert.equal(url.searchParams.get("room_name"), "r61079790522151571-l");
    assert.equal(headers.get("x-api-key"), "student-key");
    assert.equal(headers.get("x-captcha-token"), "captcha-token");
    assert.equal(headers.get("x-session-key"), calls[0].headers.get("x-session-key"));
    assert.equal(headers.get("cookie"), "captcha_sid=challenge; captcha_aux=verified");
    assert.equal(calls.filter((call) => call.url.pathname.endsWith("/apply")).length, 1);
    return new Response(JSON.stringify({ questions: [{ id: "q1" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`Upstream inesperado: ${url.pathname}`);
};

try {
  const origin = "https://sed-gg.vercel.app";
  const challengeResponse = await worker.fetch(new Request("https://proxy.example/captcha/challenge", {
    method: "POST",
    headers: { Origin: origin, "X-Token2": "student-key", "Content-Type": "application/json" },
    body: JSON.stringify({ realm: "edusp", type: "image" }),
  }));
  assert.equal(challengeResponse.status, 200);
  assert.equal(challengeResponse.headers.get("Access-Control-Allow-Origin"), origin);
  const challenge = await challengeResponse.json();
  assert.equal(challenge.challengeId, "challenge-1");
  assert.equal(challenge.image, "data:image/png;base64,AA==");
  assert.equal(challenge.captchaCookie, "captcha_sid=challenge");

  const verifyResponse = await worker.fetch(new Request("https://proxy.example/captcha/verify", {
    method: "POST",
    headers: { Origin: origin, "X-Token2": "student-key", "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: challenge.sessionKey,
      captchaCookie: challenge.captchaCookie,
      payload: { challengeId: challenge.challengeId, answer: "Pc7jg" },
    }),
  }));
  assert.equal(verifyResponse.status, 200);
  const verified = await verifyResponse.json();
  assert.equal(verified.token, "captcha-token");
  assert.equal(verified.sessionKey, challenge.sessionKey);
  assert.equal(verified.captchaCookie, "captcha_sid=challenge; captcha_aux=verified");

  const params = new URLSearchParams({ task_id: "task-1", room_name: "r61079790522151571-l" });
  const detailsResponse = await worker.fetch(new Request(`https://proxy.example/task-details?${params}`, {
    method: "GET",
    headers: {
      Origin: origin,
      "X-Token2": "student-key",
      "X-Captcha-Token": verified.token,
      "X-Captcha-Session": verified.sessionKey,
      "X-Captcha-Cookie": verified.captchaCookie,
    },
  }));
  assert.equal(detailsResponse.status, 200);
  assert.deepEqual(await detailsResponse.json(), { questions: [{ id: "q1" }] });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((call) => call.url.pathname === "/captcha/challenge").length, 1);
  assert.equal(calls.filter((call) => call.url.pathname === "/captcha/verify").length, 1);
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("/apply")).length, 1);
  console.log("test-task-captcha-worker: desafio, verificação e um único apply usam a mesma sessão e cookies.");
} finally {
  globalThis.fetch = originalFetch;
}

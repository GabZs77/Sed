import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const start = bundle.indexOf("async function requestTaskCaptchaWorker(");
const end = bundle.indexOf("async function sendAssistantMessage(", start);
assert.ok(start >= 0 && end > start, "helpers de CAPTCHA devem continuar disponíveis no bundle");

const calls = [];
const answerCalls = [];
const context = {
  URLSearchParams,
  Headers,
  Date,
  TASK_CAPTCHA_WORKER_URL: "https://sed-task-captcha.gabrielreplit56.workers.dev",
  readSession: () => ({ token2: "student-key" }),
  getErrorMessage: (data, fallback) => data?.erro || fallback,
  fetch: async (url, options = {}) => {
    const parsed = new URL(url);
    const headers = new Headers(options.headers);
    calls.push({ url: String(url), parsed, options, headers });
    assert.equal(parsed.origin, context.TASK_CAPTCHA_WORKER_URL);
    assert.equal(headers.get("X-Token2"), "student-key");
    assert.equal(options.cache, "no-store");
    let data;
    if (parsed.pathname === "/captcha/challenge") {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { realm: "edusp", type: "image" });
      data = { challengeId: "challenge-1", image: "data:image/png;base64,AA==", sessionKey: "session-1", captchaCookie: "captcha_sid=one; captcha_aux=two" };
    } else if (parsed.pathname === "/captcha/verify") {
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.equal(body.sessionKey, "session-1");
      assert.equal(body.captchaCookie, "captcha_sid=one; captcha_aux=two");
      assert.equal(body.payload.answer, "Jrwnu");
      data = { valid: true, token: "captcha-token", sessionKey: body.sessionKey, captchaCookie: body.captchaCookie };
    } else if (parsed.pathname === "/task-details") {
      assert.equal(options.method, "GET");
      assert.equal(parsed.searchParams.get("task_id"), "task-1");
      assert.equal(parsed.searchParams.get("room_name"), "2ª B - EMP LOGÍSTICA");
      assert.equal(headers.get("X-Captcha-Token"), "captcha-token");
      assert.equal(headers.get("X-Captcha-Session"), "session-1");
      assert.equal(headers.get("X-Captcha-Cookie"), "captcha_sid=one; captcha_aux=two");
      data = { questions: [{ id: "q1" }] };
    } else {
      throw new Error(`rota inesperada: ${parsed.pathname}`);
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(data) };
  },
  request: async (path, options = {}) => {
    answerCalls.push({ path, options });
    assert.equal(path, "/answer-task");
    return { ok: true };
  },
};

vm.runInNewContext(`${bundle.slice(start, end)}\nthis.fetchCaptchaChallenge=fetchCaptchaChallenge; this.verifyCaptcha=verifyCaptcha; this.fetchTaskDetails=fetchTaskDetails; this.submitTaskAnswers=submitTaskAnswers;`, context);

const challenge = await context.fetchCaptchaChallenge();
assert.equal(challenge.captchaCookie, "captcha_sid=one; captcha_aux=two");
assert.equal(calls[0].parsed.pathname, "/captcha/challenge");

const verified = await context.verifyCaptcha(challenge, " Jrwnu ");
assert.equal(verified.token, "captcha-token");
assert.equal(verified.sessionKey, challenge.sessionKey);
assert.equal(verified.captchaCookie, challenge.captchaCookie);
assert.equal(calls[1].parsed.pathname, "/captcha/verify");

await context.fetchTaskDetails("task-1", "2ª B - EMP LOGÍSTICA", verified.token, "task-code", verified.sessionKey, verified.captchaCookie);
assert.equal(calls[2].parsed.pathname, "/task-details");
assert.equal(calls.filter(({ parsed }) => parsed.pathname === "/task-details").length, 1);

await context.submitTaskAnswers("task-1", "2ª B - EMP LOGÍSTICA", { q1: "a" }, verified.token, verified.sessionKey, verified.captchaCookie);
assert.equal(answerCalls.length, 1);
assert.equal(answerCalls[0].path, "/answer-task");
assert.equal(new Headers(answerCalls[0].options.headers).get("X-Captcha-Session"), "session-1");
assert.equal(new Headers(answerCalls[0].options.headers).get("X-Captcha-Cookie"), "captcha_sid=one; captcha_aux=two");
assert.equal(JSON.parse(answerCalls[0].options.body).captcha_cookie, "captcha_sid=one; captcha_aux=two");
assert.deepEqual(calls.map(({ parsed }) => parsed.pathname), ["/captcha/challenge", "/captcha/verify", "/task-details"]);
assert.ok(bundle.includes("TASK_CAPTCHA_WORKER_URL=\"https://sed-task-captcha.gabrielreplit56.workers.dev\""));
assert.ok(bundle.includes("fetchTaskDetails(J,st,T.token,at,T.sessionKey||yt,T.captchaCookie||ct)"));
assert.ok(bundle.includes("submitTaskAnswers(J,st,R,u,yt,ct)"));
assert.ok(!bundle.includes("/api/edusp-captcha"));
assert.ok(!bundle.includes("/api/edusp-task-details"));

console.log("test-task-captcha: desafio, validação e abertura usam o Worker dedicado; sessão, cookie e um único apply são preservados.");

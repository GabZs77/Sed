import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const start = bundle.indexOf("async function fetchCaptchaChallenge(){");
const end = bundle.indexOf("async function sendAssistantMessage(", start);
assert.ok(start >= 0 && end > start, "helpers do CAPTCHA devem continuar disponíveis no bundle");

const calls = [];
const context = {
  URLSearchParams,
  Headers,
  Date,
  request: async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/captcha/challenge") {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { realm: "edusp", type: "image" });
      return { challengeId: "challenge-1", image: "data:image/png;base64,AA==", sessionKey: "session-1", captchaCookie: "captcha_sid=one; captcha_aux=two" };
    }
    if (path === "/captcha/verify") {
      const body = JSON.parse(options.body);
      assert.equal(body.sessionKey, "session-1");
      assert.equal(body.captchaCookie, "captcha_sid=one; captcha_aux=two");
      assert.equal(body.payload.answer, "Jrwnu");
      return { valid: true, token: "captcha-token", sessionKey: body.sessionKey, captchaCookie: body.captchaCookie };
    }
    if (path.startsWith("/task-details?")) return { questions: [{ id: "q1" }] };
    if (path === "/answer-task") return { ok: true };
    throw new Error(`rota inesperada: ${path}`);
  },
};

vm.runInNewContext(`${bundle.slice(start, end)}\nthis.fetchCaptchaChallenge=fetchCaptchaChallenge; this.verifyCaptcha=verifyCaptcha; this.fetchTaskDetails=fetchTaskDetails; this.submitTaskAnswers=submitTaskAnswers;`, context);

const challenge = await context.fetchCaptchaChallenge();
assert.equal(challenge.captchaCookie, "captcha_sid=one; captcha_aux=two");
assert.equal(calls[0].path, "/captcha/challenge");
assert.equal(calls[0].options.headers["Content-Type"], "application/json");

const verified = await context.verifyCaptcha(challenge, " Jrwnu ");
assert.equal(verified.token, "captcha-token");
assert.equal(verified.sessionKey, challenge.sessionKey);
assert.equal(verified.captchaCookie, challenge.captchaCookie);
assert.equal(calls[1].path, "/captcha/verify");

await context.fetchTaskDetails("task-1", "2ª B - EMP LOGÍSTICA", verified.token, "task-code", verified.sessionKey, verified.captchaCookie);
assert.equal(calls[2].path, "/task-details?task_id=task-1&room_name=2%C2%AA+B+-+EMP+LOG%C3%8DSTICA");
const detailHeaders = new Headers(calls[2].options.headers);
assert.equal(detailHeaders.get("X-Captcha-Token"), "captcha-token");
assert.equal(detailHeaders.get("X-Captcha-Session"), "session-1");
assert.equal(detailHeaders.get("X-Captcha-Cookie"), "captcha_sid=one; captcha_aux=two");
assert.equal(calls[2].options.cache, "no-store");

await context.submitTaskAnswers("task-1", "2ª B - EMP LOGÍSTICA", { q1: "a" }, verified.token, verified.sessionKey, verified.captchaCookie);
const answerCall = calls.find(({ path }) => path === "/answer-task");
assert.equal(new Headers(answerCall.options.headers).get("X-Captcha-Session"), "session-1");
assert.equal(new Headers(answerCall.options.headers).get("X-Captcha-Cookie"), "captcha_sid=one; captcha_aux=two");
assert.equal(JSON.parse(answerCall.options.body).captcha_cookie, "captcha_sid=one; captcha_aux=two");
assert.deepEqual(calls.map(({ path }) => path.split("?")[0]), ["/captcha/challenge", "/captcha/verify", "/task-details", "/answer-task"]);
assert.ok(!bundle.includes("/api/edusp-captcha"));
assert.ok(!bundle.includes("/api/edusp-task-details"));
assert.ok(bundle.includes("fetchTaskDetails(J,st,T.token,at,T.sessionKey||yt,T.captchaCookie||ct)"));
assert.ok(bundle.includes("submitTaskAnswers(J,st,R,u,yt,ct)"));

console.log("test-task-captcha: desafio, validação, abertura e envio usam o Worker; sessionKey e cookie são preservados.");

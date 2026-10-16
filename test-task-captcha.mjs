import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const start = bundle.indexOf("async function fetchCaptchaChallenge(){");
const end = bundle.indexOf("async function sendAssistantMessage(", start);
assert.ok(start >= 0 && end > start, "helpers do CAPTCHA devem continuar disponíveis no bundle");

const calls = [];
const detailsCalls = [];
const context = {
  URLSearchParams,
  Headers,
  readSession: () => ({ token2: "student-api-key-test" }),
  fetch: async (path, options = {}) => {
    detailsCalls.push({ path, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ questions: [] }) };
  },
  request: async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/captcha/challenge") return {
      challengeId: "challenge-1", image: "data:image/png;base64,AA==", sessionKey: "session-1",
      captchaCookie: "captcha_sid=one; captcha_aux=two",
    };
    if (path === "/captcha/verify") {
      const body = JSON.parse(options.body);
      assert.equal(body.sessionKey, "session-1");
      assert.equal(body.captchaCookie, "captcha_sid=one; captcha_aux=two");
      assert.equal(body.payload.answer, "Jrwnu");
      return { token: "captcha-token", sessionKey: body.sessionKey, captchaCookie: body.captchaCookie };
    }
    if (path === "/answer-task") return { ok: true };
    throw new Error(`rota inesperada: ${path}`);
  },
};
vm.runInNewContext(`${bundle.slice(start, end)}\nthis.fetchCaptchaChallenge=fetchCaptchaChallenge; this.verifyCaptcha=verifyCaptcha; this.fetchTaskDetails=fetchTaskDetails; this.submitTaskAnswers=submitTaskAnswers;`, context);

const challenge = await context.fetchCaptchaChallenge();
assert.equal(challenge.captchaCookie, "captcha_sid=one; captcha_aux=two", "cookie do desafio deve ser preservado");
const verified = await context.verifyCaptcha(challenge, " Jrwnu ");
assert.equal(verified.token, "captcha-token");
assert.equal(verified.sessionKey, "session-1");
assert.equal(verified.captchaCookie, challenge.captchaCookie);

await context.fetchTaskDetails("task-1", "2ª B - EMP LOGÍSTICA", verified.token, "task-code", verified.sessionKey, verified.captchaCookie);
assert.equal(detailsCalls.length, 1, "o token temporário do CAPTCHA deve ser usado em uma única consulta");
const detailsCall = detailsCalls[0];
assert.ok(detailsCall.path.startsWith("/api/edusp-task-details?"), "a consulta deve sair pelo proxy Vercel same-origin");
assert.match(detailsCall.path, /task_id=task-1/);
assert.match(detailsCall.path, /room_name=2%C2%AA\+B\+-\+EMP\+LOG%C3%8DSTICA/);
assert.doesNotMatch(detailsCall.path, /captcha_session|captcha_sid/);
assert.equal(detailsCall.options.headers.get("X-Api-Key"), "student-api-key-test");
assert.equal(detailsCall.options.headers.get("X-Captcha-Token"), "captcha-token");
assert.equal(detailsCall.options.headers.get("X-Captcha-Session"), "session-1");
assert.equal(detailsCall.options.headers.get("X-Captcha-Cookie"), "captcha_sid=one; captcha_aux=two");
assert.equal(detailsCall.options.cache, "no-store");

await context.submitTaskAnswers("task-1", "2ª B - EMP LOGÍSTICA", { q1: "a" }, verified.token, verified.sessionKey, verified.captchaCookie);
const answerCall = calls.find(({ path }) => path === "/answer-task");
assert.equal(answerCall.options.headers["X-Captcha-Session"], "session-1");
assert.equal(answerCall.options.headers["X-Captcha-Cookie"], "captcha_sid=one; captcha_aux=two");
const answerBody = JSON.parse(answerCall.options.body);
assert.equal(answerBody.captcha_cookie, "captcha_sid=one; captcha_aux=two");

assert.ok(bundle.includes("fetchTaskDetails(J,st,T.token,at,T.sessionKey||yt,T.captchaCookie||ct)"));
assert.ok(bundle.includes("/api/edusp-task-details?"));
assert.ok(bundle.includes("submitTaskAnswers(J,st,R,u,yt,ct)"));
console.log("test-task-captcha: sessão e cookies do CAPTCHA são preservados na consulta e no envio.");

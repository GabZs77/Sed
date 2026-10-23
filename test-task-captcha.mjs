import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const start = bundle.indexOf("async function fetchCaptchaChallenge(){");
const end = bundle.indexOf("async function sendAssistantMessage(", start);
assert.ok(start >= 0 && end > start, "helpers de CAPTCHA devem continuar disponíveis no bundle");

const calls = [];
const agreementCalls = [];
const submissionOrder = [];
let challengeCount = 0;
const context = {
  URLSearchParams,
  Headers,
  Date,
  readSession: () => ({ token2: "test-session-key", apelido: "student-test" }),
  fetch: async (url, options = {}) => {
    submissionOrder.push("agreement");
    agreementCalls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, total: 1, confirmed: 1, failed: 0 }) };
  },
  request: async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/captcha/challenge") {
      challengeCount += 1;
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { realm: "edusp", type: "image" });
      return {
        challengeId: `challenge-${challengeCount}`,
        image: "data:image/png;base64,AA==",
        sessionKey: `session-${challengeCount}`,
        captchaCookie: `captcha_sid=${challengeCount}; captcha_aux=two`,
      };
    }
    if (path === "/captcha/verify") {
      const body = JSON.parse(options.body);
      const expectedIndex = body.sessionKey === "session-1" ? 1 : 2;
      assert.equal(body.sessionKey, `session-${expectedIndex}`);
      assert.equal(body.captchaCookie, `captcha_sid=${expectedIndex}; captcha_aux=two`);
      assert.equal(body.payload.answer, expectedIndex === 1 ? "Jrwnu" : "K7x4p");
      return {
        valid: true,
        token: `captcha-token-${expectedIndex}`,
        sessionKey: body.sessionKey,
        captchaCookie: body.captchaCookie,
      };
    }
    if (path.startsWith("/task-details?")) return { questions: [{ id: "q1" }] };
    if (path === "/answer-task") { submissionOrder.push("activity"); return { ok: true }; }
    throw new Error(`rota inesperada: ${path}`);
  },
};

vm.runInNewContext(
  `${bundle.slice(start, end)}\n` +
    "this.fetchCaptchaChallenge=fetchCaptchaChallenge; " +
    "this.verifyCaptcha=verifyCaptcha; " +
    "this.fetchTaskDetails=fetchTaskDetails; " +
    "this.submitTaskAnswers=submitTaskAnswers; " +
    "this.submitTaskAgreement=submitTaskAgreement; " +
    "this.submitTaskAnswersWithCaptcha=submitTaskAnswersWithCaptcha;",
  context,
);

const readChallenge = await context.fetchCaptchaChallenge();
assert.equal(readChallenge.captchaCookie, "captcha_sid=1; captcha_aux=two");
assert.equal(calls[0].path, "/captcha/challenge");
assert.equal(calls[0].options.headers["Content-Type"], "application/json");

const readVerified = await context.verifyCaptcha(readChallenge, " Jrwnu ");
assert.equal(readVerified.token, "captcha-token-1");
assert.equal(readVerified.sessionKey, readChallenge.sessionKey);
assert.equal(readVerified.captchaCookie, readChallenge.captchaCookie);
assert.equal(calls[1].path, "/captcha/verify");

await context.fetchTaskDetails(
  "task-1",
  "2ª B - EMP LOGÍSTICA",
  readVerified.token,
  "task-code",
  readVerified.sessionKey,
  readVerified.captchaCookie,
);
assert.equal(calls[2].path, "/task-details?task_id=task-1&room_name=2%C2%AA+B+-+EMP+LOG%C3%8DSTICA");
const detailHeaders = new Headers(calls[2].options.headers);
assert.equal(detailHeaders.get("X-Captcha-Token"), "captcha-token-1");
assert.equal(detailHeaders.get("X-Captcha-Session"), "session-1");
assert.equal(detailHeaders.get("X-Captcha-Cookie"), "captcha_sid=1; captcha_aux=two");
assert.equal(calls[2].options.cache, "no-store");

const submissionChallenge = await context.fetchCaptchaChallenge();
assert.equal(calls[3].path, "/captcha/challenge");
const chosenAnswers = {
  q1: { question_id: "q1", question_type: "single", value: { option_a: false, option_b: true } },
};
const submitted = await context.submitTaskAnswersWithCaptcha(
  "task-1",
  "2ª B - EMP LOGÍSTICA",
  chosenAnswers,
  submissionChallenge,
  "K7x4p",
  60,
);
assert.equal(submitted.token, "captcha-token-2");
assert.equal(submitted.agreement.confirmed, 1);
assert.equal(calls[4].path, "/captcha/verify");
assert.equal(calls[5].path, "/answer-task");
assert.equal(agreementCalls.length, 1);
assert.equal(agreementCalls[0].url, "/api/edusp-agreements");
assert.equal(agreementCalls[0].options.method, "POST");
assert.equal(agreementCalls[0].options.headers["X-Api-Key"], "test-session-key");
assert.deepEqual(JSON.parse(agreementCalls[0].options.body), { taskId: "task-1", agreed: true });
assert.deepEqual(submissionOrder, ["activity", "agreement"]);
const answerHeaders = new Headers(calls[5].options.headers);
assert.equal(answerHeaders.get("X-Captcha-Token"), "captcha-token-2");
assert.equal(answerHeaders.get("X-Captcha-Session"), "session-2");
assert.equal(answerHeaders.get("X-Captcha-Cookie"), "captcha_sid=2; captcha_aux=two");
const answerBody = JSON.parse(calls[5].options.body);
assert.equal(answerBody.captcha_token, "captcha-token-2");
assert.equal(answerBody.captcha_session, "session-2");
assert.equal(answerBody.captcha_cookie, "captcha_sid=2; captcha_aux=two");
assert.equal(answerBody.duration, 60);
assert.deepEqual(answerBody.answers.q1.value, { option_a: false, option_b: true });
assert.deepEqual(
  calls.map(({ path }) => path.split("?")[0]),
  ["/captcha/challenge", "/captcha/verify", "/task-details", "/captcha/challenge", "/captcha/verify", "/answer-task"],
);

assert.ok(!bundle.includes("/api/edusp-captcha"));
assert.ok(!bundle.includes("/api/edusp-task-details"));
assert.ok(bundle.includes("submitTaskAnswersWithCaptcha(J,st,pendingAnswers,c,_,durationSeconds)"));
assert.ok(bundle.includes("setPendingDurationSeconds(getTaskDurationMinutes()*60),setPendingAnswers(R),setSubmitMode(true)"), "o duration selecionado deve ser congelado no clique em Enviar");
assert.ok(bundle.includes("const durationSeconds=pendingDurationSeconds;"), "o valor congelado deve ser enviado após validar o CAPTCHA");
assert.ok(bundle.includes("await submitTaskAgreement(taskId)"), "a confirmação automática deve acontecer depois do envio da atividade");
assert.ok(bundle.includes("void At(true)"), "o botão Enviar deve gerar um segundo desafio");
assert.ok(bundle.includes("Resolva um novo CAPTCHA antes de enviar suas respostas à Sala do Futuro."));
assert.ok(!bundle.includes("submitTaskAnswers(J,st,R,u,yt,ct)"), "não enviar usando o CAPTCHA da leitura");

console.log("test-task-captcha: CAPTCHA novo validado; atividade enviada antes do acordo automático.");

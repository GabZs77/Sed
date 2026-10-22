import assert from "node:assert/strict";
import {
  buildTaskSubmissionPayload,
  normalizeTaskSubmissionAnswers,
  submitTaskAnswers,
} from "./task-answer-worker.mjs";

const chosenAnswers = {
  "101": {
    question_id: "101",
    question_type: "fill-words",
    answer: { 1: "b", 0: "a" },
  },
  "102": {
    question_id: "102",
    question_type: "single",
    value: { option_a: false, option_b: true },
  },
};
const originalAnswers = structuredClone(chosenAnswers);

const normalized = normalizeTaskSubmissionAnswers(chosenAnswers);
assert.deepEqual(normalized["101"].answer, ["a", "b"]);
assert.deepEqual(normalized["102"].answer, { option_a: false, option_b: true });
assert.equal(normalized["101"].question_id, 101);
assert.equal(normalized["102"].question_type, "single");
assert.equal(normalized["102"].question_invalid, false);
assert.deepEqual(chosenAnswers, originalAnswers, "normalização não altera as respostas originais");

const payload = buildTaskSubmissionPayload({
  taskId: "9876",
  studentId: "1234",
  studentNick: "aluno-teste",
  answers: chosenAnswers,
  durationSeconds: 87,
});
assert.deepEqual(Object.keys(payload), [
  "id", "nick", "status", "task_id", "answers", "duration",
  "revised_request_count", "task_published", "task_expired",
  "enable_display_answers", "result_score",
]);
assert.equal(payload.status, "submitted");
assert.equal(payload.task_id, 9876);
assert.equal(payload.duration, "87");
assert.equal(payload.result_score, 0);

let captured;
const success = await submitTaskAnswers({
  taskId: "9876",
  studentId: "1234",
  studentNick: "aluno-teste",
  answers: chosenAnswers,
  durationSeconds: 87,
  captchaToken: "fresh-token",
  captchaSessionKey: "fresh-session",
}, {
  apiBaseUrl: "https://upstream.invalid",
  upstreamHeaders: { Origin: "https://example.invalid" },
  apiKey: "test-key-not-a-secret",
  fetchImpl: async (url, init) => {
    captured = { url, init };
    assert.equal(init.method, "POST");
    assert.equal("cache" in init, false, "não usar RequestInit.cache no Worker");
    assert.equal(new Headers(init.headers).get("X-Api-Key"), "test-key-not-a-secret");
    assert.equal(new Headers(init.headers).get("X-Captcha-Token"), "fresh-token");
    assert.equal(new Headers(init.headers).get("X-Session-Key"), "fresh-session");
    return { ok: true, status: 201, json: async () => ({ status: "submitted" }) };
  },
});
assert.equal(captured.url, "https://upstream.invalid/tms/task/9876/answer");
assert.equal(JSON.parse(captured.init.body).status, "submitted");
assert.deepEqual(JSON.parse(captured.init.body).answers["101"].answer, ["a", "b"]);
assert.equal(success.resp.ok, true);
assert.equal(success.data.status, "submitted");

const noCaptcha = await submitTaskAnswers({
  taskId: "9876", studentId: "1234", studentNick: "aluno-teste", answers: chosenAnswers,
}, {
  apiBaseUrl: "https://upstream.invalid",
  apiKey: "test-key-not-a-secret",
  fetchImpl: async () => { throw new Error("não deve chamar o upstream sem CAPTCHA"); },
});
assert.equal(noCaptcha.resp.status, 403);

const upstreamFailure = await submitTaskAnswers({
  taskId: "9876", studentId: "1234", studentNick: "aluno-teste", answers: chosenAnswers,
  captchaToken: "fresh-token", captchaSessionKey: "fresh-session", durationSeconds: 87,
}, {
  apiBaseUrl: "https://upstream.invalid",
  apiKey: "test-key-not-a-secret",
  fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
});
assert.equal(upstreamFailure.resp.ok, false);
assert.equal(upstreamFailure.resp.status, 502);

console.log("test-task-answer-worker: payload, respostas manuais, CAPTCHA novo e POST sem cache validados.");

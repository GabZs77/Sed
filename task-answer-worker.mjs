const REJECTED_STATUSES = new Set(["failed", "error", "rejected", "not_submitted"]);

function numericId(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 0 ? number : text;
}

function answerValue(item, questionType) {
  const value = Object.prototype.hasOwnProperty.call(item, "answer")
    ? item.answer
    : item.value;
  if (value === undefined || value === null) return [];

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ["fill-words", "order-sentences", "word-order"].includes(questionType) &&
    Object.keys(value).every((key) => /^\d+$/.test(key))
  ) {
    return Object.keys(value)
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => value[key]);
  }

  // Preserve the shape chosen in the UI (arrays and option maps included).
  return value;
}

export function normalizeTaskSubmissionAnswers(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new TypeError("As respostas da atividade estão em formato inválido.");
  }

  const entries = Object.entries(answers);
  if (!entries.length) throw new TypeError("A atividade não contém respostas para enviar.");

  return Object.fromEntries(entries.map(([key, rawItem]) => {
    const item = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)
      ? rawItem
      : { value: rawItem };
    const questionType = String(item.question_type ?? item.type ?? "").trim();
    const questionId = numericId(item.question_id ?? key);
    if (questionId === null || !questionType) {
      throw new TypeError("Uma resposta está sem identificação de questão.");
    }

    const suppliedScore = Number(item.score);
    return [String(questionId), {
      score: Number.isFinite(suppliedScore) ? suppliedScore : 0,
      answer: answerValue(item, questionType),
      question_id: questionId,
      question_type: questionType,
      question_invalid: Boolean(item.question_invalid ?? false),
    }];
  }));
}

export function buildTaskSubmissionPayload({
  taskId,
  studentId,
  studentNick,
  answers,
  durationSeconds = 0,
}) {
  const id = numericId(studentId);
  const task_id = numericId(taskId);
  const nick = String(studentNick ?? "").trim();
  const seconds = Number(durationSeconds);

  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) {
    throw new TypeError("Não foi possível identificar o código do aluno para enviar a atividade.");
  }
  if (typeof task_id !== "number" || !Number.isSafeInteger(task_id) || task_id < 0) {
    throw new TypeError("O identificador da atividade é inválido.");
  }
  if (!nick) throw new TypeError("Não foi possível identificar o aluno para enviar a atividade.");
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new TypeError("O tempo de atividade está inválido.");
  }

  return {
    id,
    nick,
    status: "submitted",
    task_id,
    answers: normalizeTaskSubmissionAnswers(answers),
    duration: String(Math.floor(seconds)),
    revised_request_count: null,
    task_published: true,
    task_expired: false,
    enable_display_answers: false,
    result_score: 0,
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function submitTaskAnswers(input, {
  apiBaseUrl,
  upstreamHeaders = {},
  apiKey = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("O envio da atividade não está disponível neste momento.");
  }
  const captchaToken = String(input?.captchaToken ?? "").trim();
  const captchaSessionKey = String(input?.captchaSessionKey ?? "").trim();
  if (!captchaToken || !captchaSessionKey) {
    return {
      resp: { ok: false, status: 403 },
      data: { error: "Resolva um novo CAPTCHA antes de enviar a atividade." },
    };
  }

  let payload;
  try {
    payload = buildTaskSubmissionPayload(input || {});
  } catch (error) {
    return {
      resp: { ok: false, status: 400 },
      data: { error: error instanceof Error ? error.message : "Dados da atividade inválidos." },
    };
  }

  const baseUrl = String(apiBaseUrl ?? "").replace(/\/$/, "");
  if (!baseUrl) throw new TypeError("O endereço da plataforma de atividades não está configurado.");

  const headers = new Headers(upstreamHeaders);
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  headers.set("X-Requested-With", "XMLHttpRequest");
  if (apiKey) headers.set("X-Api-Key", String(apiKey));
  if (!headers.has("X-Api-Key")) {
    throw new TypeError("A chave de acesso da plataforma de atividades não está configurada.");
  }
  headers.set("X-Captcha-Token", captchaToken);
  headers.set("X-Session-Key", captchaSessionKey);

  const url = `${baseUrl}/tms/task/${encodeURIComponent(String(payload.task_id))}/answer`;
  let response;
  try {
    // Cloudflare Workers do not support RequestInit.cache; intentionally omit it.
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      resp: { ok: false, status: 502 },
      data: { error: "Não foi possível conectar à plataforma para enviar a atividade." },
    };
  }

  const responseData = await readJson(response);
  const returnedStatus = String(
    responseData?.status ?? responseData?.answer_status ?? "",
  ).toLowerCase();
  const statusRejected = REJECTED_STATUSES.has(returnedStatus);
  const ok = Boolean(response.ok && !statusRejected);

  if (!ok) {
    const status = response.ok ? 409 : response.status;
    const error = response.ok
      ? "A plataforma recebeu o envio, mas ainda não confirmou a atividade como enviada."
      : `A plataforma recusou o envio da atividade (HTTP ${response.status}).`;
    return { resp: { ok: false, status }, data: { error }, url };
  }

  return {
    resp: { ok: true, status: response.status },
    data: { status: returnedStatus || "submitted" },
    url,
  };
}

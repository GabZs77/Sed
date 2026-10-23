// Confirma automaticamente o comentário do Assistente de Correção após o envio da tarefa.
// Os IDs são obtidos da resposta pendente da EduSP; a chave de sessão nunca é registrada.
const UPSTREAM = "https://edusp-api.ip.tv";
const PAGE_SIZE = 20;
const MAX_PAGES = 25;
const MAX_BATCH = 100;
const LOOKUP_RETRIES = 2;
const LOOKUP_RETRY_DELAY_MS = 700;

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = origin === "https://sed-gg.vercel.app" || /^https:\/\/sed-[a-z0-9-]+-hackersroblox66-gmailcoms-projects\.vercel\.app$/i.test(origin);
  res.setHeader("Access-Control-Allow-Origin", allowed ? origin : "https://sed-gg.vercel.app");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "X-Api-Key, X-Task-User, Content-Type, Accept");
  res.setHeader("Cache-Control", "no-store");
}

function getSession(req) {
  const key = String(req.headers["x-api-key"] || "").trim();
  if (!key || key.length > 4096) return { error: "Sessão EduSP ausente ou inválida." };
  let nick = String(req.headers["x-task-user"] || "").trim();
  const parts = key.split(".");
  if (parts.length >= 2) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      nick = String(payload.nick || payload.nickname || payload.apelido || nick).trim();
    } catch { /* A EduSP valida a chave no upstream. */ }
  }
  if (!nick || nick.length > 200) return { error: "Não foi possível identificar a sessão do aluno." };
  return { key, nick };
}

function validId(value) {
  const text = String(value ?? "").trim();
  return /^\d{1,24}$/.test(text) ? text : "";
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const name of ["data", "results", "answers", "items"]) {
    const value = payload[name];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const values = Object.values(value);
      if (values.length && values.every(item => item && typeof item === "object")) return values;
    }
  }
  return payload.id != null && payload.task_id != null ? [payload] : [];
}

function isTrue(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function isFinished(value) {
  return ["finished", "completed", "complete", "concluded", "concluida", "concluído", "done"].includes(String(value ?? "").trim().toLowerCase());
}

function isPendingAgreement(record, answer) {
  const answerAgreement = answer?.agreement ?? answer?.agreed;
  if (answerAgreement !== undefined && answerAgreement !== null) return !isTrue(answerAgreement);
  const answerPending = [answer?.pending_agreement, answer?.pendingAgreement, answer?.answer_pending_agreement];
  if (answerPending.some(value => value !== undefined && value !== null)) return answerPending.some(isTrue);
  const recordAgreement = record?.agreement ?? record?.agreed;
  if (recordAgreement !== undefined && recordAgreement !== null) return !isTrue(recordAgreement);
  return [record?.pending_agreement, record?.pendingAgreement].some(isTrue);
}

function pendingCorrections(records) {
  const result = [];
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object" || !isFinished(record.status ?? record.task_status ?? record.answer_status ?? record.task?.status)) continue;
    const answers = record.answers;
    const entries = Array.isArray(answers)
      ? answers.map((item, index) => [String(item?.question_id ?? index), item])
      : answers && typeof answers === "object" ? Object.entries(answers) : [];
    for (const [key, item] of entries) {
      if (!item || typeof item !== "object") continue;
      const validation = item.ia_validation || item.IAValidation;
      const hasComment = typeof validation?.validation === "string" && validation.validation.trim();
      const hasFinishedCorrection = isFinished(validation?.revision_status || validation?.status);
      if (!isPendingAgreement(record, item) || !hasFinishedCorrection || !hasComment) continue;
      const taskId = String(record.task_id ?? record.taskId ?? "");
      const answerId = String(record.id ?? record.answer_id ?? record.answerId ?? "");
      const questionId = String(item.question_id ?? item.questionId ?? key);
      if (![taskId, answerId, questionId].every(value => /^\d{1,24}$/.test(value))) continue;
      const identity = `${taskId}:${questionId}:${answerId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      result.push({ taskId, questionId, answerId });
    }
  }
  return result;
}

async function upstreamRequest(path, key, method = "GET", body) {
  const headers = {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Origin: "https://saladofuturo.educacao.sp.gov.br",
    Referer: "https://saladofuturo.educacao.sp.gov.br/",
    "Content-Type": "application/json",
    "x-api-platform": "webclient",
    "x-api-realm": "edusp",
    "X-Api-Key": key,
  };
  const response = await fetch(`${UPSTREAM}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

async function studentTargets(session) {
  const response = await upstreamRequest("/room/user?list_all=true&with_cards=true", session.key);
  if (!response.ok) return { error: true, status: response.status };
  const rooms = Array.isArray(response.data?.rooms)
    ? response.data.rooms
    : Array.isArray(response.data?.data?.rooms) ? response.data.data.rooms : [];
  const targets = new Set();
  for (const room of rooms) {
    const roomId = String(room?.id ?? room?.room_id ?? room?.roomId ?? "").trim();
    const roomName = String(room?.name ?? room?.room_name ?? room?.roomName ?? "").trim();
    if (roomId) {
      targets.add(roomId);
      targets.add(`${roomId}:${session.nick}`);
    }
    if (roomName) targets.add(roomName);
    const groups = Array.isArray(room?.group_categories) ? room.group_categories : Array.isArray(room?.groups) ? room.groups : [];
    for (const group of groups) {
      const id = String(typeof group === "string" ? group : group?.id ?? "").trim();
      if (id) targets.add(id);
    }
  }
  return { targets: [...targets] };
}

async function listPending(session) {
  const targetResult = await studentTargets(session);
  if (targetResult.error) return { error: true, status: targetResult.status };
  const collected = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ nick: session.nick, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), task_is_exam: "false", task_is_essay: "false" });
    for (const target of targetResult.targets) params.append("publication_target", target);
    let response = await upstreamRequest(`/tms/answer?${params.toString()}`, session.key);
    if (!response.ok && page === 0) {
      const fallback = new URLSearchParams({ nick: session.nick, limit: String(PAGE_SIZE), offset: "0" });
      for (const target of targetResult.targets) fallback.append("publication_target", target);
      response = await upstreamRequest(`/tms/answer?${fallback.toString()}`, session.key);
    }
    if (!response.ok) return { error: true, status: response.status };
    const rows = rowsFrom(response.data);
    collected.push(...rows);
    if (rows.length < PAGE_SIZE) return { corrections: pendingCorrections(collected) };
  }
  return { error: true, status: 502 };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido." });
  const session = getSession(req);
  if (session.error) return res.status(400).json({ erro: session.error });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const taskId = validId(body.taskId ?? body.task_id);
  if (!taskId) return res.status(400).json({ erro: "Identificador da atividade inválido." });
  if (body.agreed !== true) return res.status(400).json({ erro: "A confirmação agreed=true é obrigatória." });

  try {
    let corrections = [];
    for (let attempt = 0; attempt < LOOKUP_RETRIES; attempt += 1) {
      const listed = await listPending(session);
      if (listed.error) {
        const status = listed.status >= 400 && listed.status < 500 ? listed.status : 502;
        return res.status(status).json({ erro: "Não foi possível consultar a correção da atividade enviada." });
      }
      corrections = listed.corrections.filter(item => item.taskId === taskId).slice(0, MAX_BATCH);
      if (corrections.length || attempt + 1 === LOOKUP_RETRIES) break;
      await delay(LOOKUP_RETRY_DELAY_MS);
    }

    if (!corrections.length) {
      return res.status(200).json({ ok: true, taskId, total: 0, confirmed: 0, failed: 0, pending: false });
    }

    const results = [];
    for (let start = 0; start < corrections.length; start += 4) {
      const batch = corrections.slice(start, start + 4);
      const batchResults = await Promise.all(batch.map(async item => {
        const path = `/tms/task/${item.taskId}/question/${item.questionId}/answer/${item.answerId}/agreement`;
        try {
          const response = await upstreamRequest(path, session.key, "PUT", { agreed: true });
          return { ok: response.ok, status: response.status };
        } catch {
          return { ok: false, status: 502 };
        }
      }));
      results.push(...batchResults);
    }
    const confirmed = results.filter(item => item.ok).length;
    const failed = results.length - confirmed;
    const status = failed ? 207 : 200;
    return res.status(status).json({ ok: failed === 0, taskId, total: results.length, confirmed, failed, pending: true });
  } catch {
    return res.status(502).json({ erro: "Não foi possível confirmar o comentário de correção na EduSP." });
  }
};

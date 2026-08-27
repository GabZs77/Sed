const EXTRA_TARGETS = ["1052", "1820", "764"];
const EDUSP_BASE = "https://edusp-api.ip.tv";
const SED_BASE = "https://sedintegracoes.educacao.sp.gov.br";
const WORKER_BUILD = "sdf-flash-v9-20260826-authenticated-rooms";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function getSubscriptionKeys(env) {
  return {
    login: String(env?.SED_LOGIN_SUBSCRIPTION_KEY || "").trim(),
    turmas: String(env?.SED_TURMAS_SUBSCRIPTION_KEY || env?.SED_LOGIN_SUBSCRIPTION_KEY || "").trim(),
    aluno: String(env?.SED_ALUNO_SUBSCRIPTION_KEY || "").trim(),
    boletim: String(env?.SED_BOLETIM_SUBSCRIPTION_KEY || "").trim(),
    hub: String(env?.SED_HUB_SUBSCRIPTION_KEY || "").trim(),
  };
}

// Notificações: sem KV/D1/R2. O Worker mantém a lista no runtime atual.
// O frontend também guarda um cache no localStorage para sobreviver a recarregamentos.
// Observação: sem um banco/KV externo, nenhuma solução no Worker puro garante
// persistência após reinicialização/novo deploy do Worker.
let NOTIFICATIONS_DB = [];

const UPSTREAM_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://saladofuturo.educacao.sp.gov.br",
  Referer: "https://saladofuturo.educacao.sp.gov.br/",
};

// =======================================================
// FUNÇÕES AUXILIARES
// =======================================================
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Token, X-Token2, X-Api-Key, X-Cd-Usuario, X-Task-User, X-Usuario, X-Captcha-Token, X-Admin-User",
  };
}

function getEduApiKey(request) {
  const raw = request.headers.get("X-Token2") || request.headers.get("X-Api-Key") || "";
  const key = String(raw).trim();
  if (!key || key === "null" || key === "undefined") return "";
  return key;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Worker-Build": WORKER_BUILD,
      ...corsHeaders(),
    },
  });
}

async function readJson(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function addUnique(array, value) {
  if (value === null || value === undefined || value === "") return;
  const s = String(value);
  if (!array.includes(s)) array.push(s);
}

function normalizeStudentCode(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // A API de Turma/Aluno usa o código curto de 8 dígitos; o login e
  // algumas APIs de notificações usam o CD_USUARIO completo de 9 dígitos.
  if (digits.length === 9) return String(Math.trunc(Number(digits) / 10));
  return digits;
}

function unwrapSedList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.result)) return data.result;
  if (Array.isArray(data.results)) return data.results;
  if (data.data && typeof data.data === "object") return [data.data];
  return [];
}

function toTitleCase(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
}

function roomNameFromDescription(description) {
  const raw = String(description || "").trim();
  if (!raw) return "";
  const parts = raw.split(" - ");
  if (parts.length >= 3) {
    const curso = toTitleCase(parts[1].trim());
    let serieRaw = parts[2].trim();
    const match = serieRaw.match(/(MANH|TARD|NOIT|ANUA)/i);
    if (match) serieRaw = serieRaw.slice(0, match.index);
    const serieLimpa = toTitleCase(serieRaw.trim().replace(/SERIE/gi, "Série"));
    return `${curso} - ${serieLimpa}`;
  }
  if (parts.length >= 2) return toTitleCase(parts[1].trim());
  return toTitleCase(raw);
}

function normalizeRoom(room) {
  const descricao = room?.DescricaoTurma ?? room?.descricaoTurma ?? room?.descricao ?? room?.description ?? "";
  const name = roomNameFromDescription(descricao) || String(room?.NomeTurma ?? room?.name ?? room?.topic ?? "").trim();
  return {
    id: room?.CodigoTurma ?? room?.codigoTurma ?? room?.id ?? null,
    numeroClasse: room?.NumeroClasse ?? room?.numeroClasse ?? null,
    identificador: room?.IdentificadorTurma ?? room?.identificadorTurma ?? "",
    descricao: descricao,
    name,
    escola: room?.NomeEscola ?? room?.nomeEscola ?? "",
    codigoEscola: room?.CodigoEscola ?? room?.codigoEscola ?? null,
    curso: name ? name.split(" - ")[0] : "",
  };
}

function extractTasks(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["tasks", "items", "data", "results", "todo"]) if (Array.isArray(data[key])) return data[key];
  return [];
}

function normalizeTask(task, roomName = "") {
  return {
    id: task?.id ?? task?.task_id ?? task?.taskId ?? null,
    title: task?.title ?? task?.name ?? task?.titulo ?? "Tarefa",
    subject: task?.discipline_name ?? task?.disciplineName ?? task?.subject_name ?? task?.subject ?? task?.materia ?? "",
    room: roomName,
    status: task?.answer_status ?? task?.status ?? "pending",
    due: task?.apply_moment ?? task?.applyMoment ?? task?.due_date ?? task?.dueDate ?? task?.deadline ?? null,
    raw: task,
  };
}

// =======================================================
// PROXY DE PDF DAS APOSTILAS
// =======================================================
async function handlePdfProxy(request, url) {
  const target = url.searchParams.get("url") || "";
  if (!target) return new Response("Parâmetro url ausente", { status: 400, headers: corsHeaders() });
  let targetUrl;
  try { targetUrl = new URL(target); } catch { return new Response("URL inválida", { status: 400, headers: corsHeaders() }); }
  if (targetUrl.protocol !== "https:" || targetUrl.hostname !== "raw.githubusercontent.com") {
    return new Response("Domínio não permitido", { status: 403, headers: corsHeaders() });
  }
  const resp = await fetch(targetUrl.toString(), { headers: { Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8" }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!resp.ok) return new Response(await resp.text(), { status: resp.status, headers: { ...corsHeaders(), "Content-Type": resp.headers.get("content-type") || "text/plain" } });
  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", resp.headers.get("content-type") || "application/pdf");
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Content-Disposition", "inline");
  return new Response(resp.body, { status: 200, headers });
}

// =======================================================
// CAPTCHA SED / EduSP
// =======================================================
function captchaHeaders(token2, sessionKey = "") {
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: UPSTREAM_HEADERS.Origin,
    Referer: UPSTREAM_HEADERS.Referer,
    "User-Agent": UPSTREAM_HEADERS["User-Agent"],
    "x-api-platform": "webclient",
    "x-api-realm": "edusp",
    "x-api-key": token2,
  };
}

async function handleCaptchaChallenge(request) {
  const token2 = getEduApiKey(request);
  if (!token2) return jsonResponse({ erro: "Cabeçalho X-Token2 ausente" }, 400);
  let body = { realm: "edusp", type: "image" };
  try {
    const incoming = await request.json();
    if (incoming && typeof incoming === "object") body = { ...body, ...incoming };
  } catch {}
  const sessionKey = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : String(Date.now());
  const urls = [`${EDUSP_BASE}/captcha/challenge`, `${EDUSP_BASE}/captcha/challenge?realm=edusp`];
  let last = null;
  for (const url of urls) {
    try {
      const init = { method: "POST", headers: captchaHeaders(token2, sessionKey), body: JSON.stringify(body) };
      if (url.includes("?realm=")) delete init.body;
      const resp = await fetch(url, init);
      const data = await readJson(resp);
      last = { resp, data };
      if (resp.ok) {
        const captchaCookie = resp.headers.get("set-cookie") || "";
        return jsonResponse({
          ...data,
          challengeId: data?.challengeId ?? data?.challenge_id ?? data?.id ?? data?.data?.challenge_id ?? data?.data?.id,
          image: data?.challenge?.image ?? data?.image ?? data?.data?.image ?? data?.data?.challenge?.image,
          sessionKey,
          captchaCookie,
        }, resp.status);
      }
    } catch {}
  }
  return jsonResponse({ erro: "Não foi possível carregar o CAPTCHA.", detalhe: last?.data || null }, last?.resp?.status || 502);
}

async function handleCaptchaVerify(request) {
  const token2 = getEduApiKey(request);
  if (!token2) return jsonResponse({ erro: "Cabeçalho X-Token2 ausente" }, 400);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: "Corpo do CAPTCHA inválido" }, 400); }
  const payload = body?.payload || {};
  if (!payload.challengeId || !payload.answer) return jsonResponse({ erro: "challengeId e answer são obrigatórios" }, 400);
  const sessionKey = body?.sessionKey || request.headers.get("X-Captcha-Session") || "";
  const captchaCookie = body?.captchaCookie || "";
  const headers = captchaHeaders(token2, sessionKey);
  if (captchaCookie) headers.Cookie = String(captchaCookie);
  const resp = await fetch(`${EDUSP_BASE}/captcha/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "image", realm: "edusp", payload: { challengeId: payload.challengeId, answer: String(payload.answer).trim() } }),
  });
  const data = await readJson(resp);
  const token = data?.token || data?.captcha_token || data?.captchaToken || data?.data?.token || data?.data?.captcha_token || "";
  return jsonResponse({ ...data, token, valid: Boolean(token || data?.valid) }, resp.status);
}

// =======================================================
// FUNÇÕES DE API (SED/EDUSP)
// =======================================================
async function fetchTurmas(token, cdUsuarioCurto, env) {
  const keys = getSubscriptionKeys(env);
  const codigoAluno = normalizeStudentCode(cdUsuarioCurto);
  const url = `${SED_BASE}/saladofuturobffapi/apihubintegracoes/api/v2/Turma/ListarTurmasPorAluno?codigoAluno=${encodeURIComponent(codigoAluno)}`;
  const headers = {
    ...UPSTREAM_HEADERS,
    "Ocp-Apim-Subscription-Key": keys.turmas,
    "x-product-name": "SalaDoFuturo",
  };
  if (token) headers.Authorization = `Bearer ${String(token).replace(/^Bearer\s+/i, "")}`;
  const resp = await fetch(url, { headers });
  const data = await readJson(resp);
  return { resp, data, codigoAluno, rooms: unwrapSedList(data).map(normalizeRoom) };
}

async function fetchTasksForTargets(token2, targets) {
  const params = new URLSearchParams();
  params.set("expired_only", "false"); params.set("limit", "100"); params.set("offset", "0");
  params.set("filter_expired", "true"); params.set("is_exam", "false"); params.set("with_answer", "true");
  params.set("is_essay", "false"); params.append("answer_statuses", "draft"); params.append("answer_statuses", "pending");
  params.set("with_apply_moment", "true");
  for (const target of targets) params.append("publication_target", target);
  const resp = await fetch(`${EDUSP_BASE}/tms/task/todo?${params.toString()}`, {
    headers: { ...UPSTREAM_HEADERS, "content-type": "application/json", "x-api-platform": "webclient", "x-api-realm": "edusp", "x-api-key": token2 },
  });
  return { resp, data: await readJson(resp) };
}

async function fetchEduspRoomTargets(token2) {
  const targets = [];
  try {
    const resp = await fetch(`${EDUSP_BASE}/room/user?list_all=true&with_cards=true`, {
      headers: { ...UPSTREAM_HEADERS, "content-type": "application/json", "x-api-platform": "webclient", "x-api-realm": "edusp", "x-api-key": token2 },
    });
    if (!resp.ok) return targets;
    const data = await readJson(resp);
    const eduspRooms = Array.isArray(data?.rooms) ? data.rooms : [];
    for (const room of eduspRooms) {
      addUnique(targets, room?.name);
      const categories = Array.isArray(room?.group_categories) ? room.group_categories : [];
      for (const cat of categories) addUnique(targets, cat?.id);
    }
  } catch {}
  return targets;
}

async function fetchTasks(token2, rooms, username) {
  const baseTargets = [];
  for (const target of await fetchEduspRoomTargets(token2)) addUnique(baseTargets, target);
  for (const room of rooms) {
    if (!room.name) continue;
    addUnique(baseTargets, room.name);
    if (username) addUnique(baseTargets, `${room.name}:${username}-sp`);
  }
  for (const target of EXTRA_TARGETS) addUnique(baseTargets, target);
  let result = await fetchTasksForTargets(token2, baseTargets);
  let rawTasks = result.resp.ok ? extractTasks(result.data) : [];
  if (result.resp.ok && rawTasks.length === 0) {
    const all = [];
    for (const target of baseTargets) {
      const one = await fetchTasksForTargets(token2, [target]);
      if (!one.resp.ok) continue;
      all.push(...extractTasks(one.data));
    }
    rawTasks = all;
  }
  const seen = new Set();
  const tasks = [];
  for (const raw of rawTasks) {
    const id = String(raw?.id ?? raw?.task_id ?? raw?.taskId ?? `${raw?.title}|${raw?.apply_moment ?? ""}`);
    if (seen.has(id)) continue;
    seen.add(id);
    tasks.push(normalizeTask(raw, findRoomForTask(raw, rooms)));
  }
  return { ok: result.resp.ok, status: result.resp.status, tasks, targets: baseTargets, raw: result.data };
}

function findRoomForTask(task, rooms) {
  const text = JSON.stringify(task || "").toLowerCase();
  for (const room of rooms) {
    if (room.name && text.includes(room.name.toLowerCase())) return room.name;
    if (room.id !== null && text.includes(String(room.id))) return room.name;
  }
  return "";
}

async function fetchFaltas(cdUsuarioCurto, env) {
  const keys = getSubscriptionKeys(env);
  const url = `${SED_BASE}/apiboletim/api/Frequencia/GetFaltasBimestreAtual?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Content-Type": "application/json", "ocp-apim-subscription-key": keys.boletim } });
  const data = await readJson(resp);
  return { resp, data, total: extractFaltasBimestre(data) };
}

function extractFaltasBimestre(data) {
  const exactKeys = ["faltasBimestreAtual", "FaltasBimestreAtual", "totalFaltasBimestre", "TotalFaltasBimestre", "quantidadeFaltasBimestre", "QuantidadeFaltasBimestre", "totalFaltas", "TotalFaltas", "faltas", "Faltas"];
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) { const found = walk(item); if (found !== null) return found; } return null; }
    for (const key of exactKeys) { if (Object.prototype.hasOwnProperty.call(node, key)) { const n = numberValue(node[key]); if (n !== null) return n; } }
    for (const value of Object.values(node)) { const found = walk(value); if (found !== null) return found; }
    return null;
  }
  const explicit = walk(data);
  if (explicit !== null) return explicit;
  let sum = 0; let found = false;
  const visited = new WeakSet();
  function sumExact(node) {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) return node.forEach(sumExact);
    for (const [key, value] of Object.entries(node)) {
      if (/^faltas?$/i.test(key)) { const n = numberValue(value); if (n !== null) { sum += n; found = true; } }
      else if (value && typeof value === "object") { sumExact(value); }
    }
  }
  sumExact(data);
  return found ? sum : null;
}

async function fetchNotifications(cdUsuario, env) {
  const keys = getSubscriptionKeys(env);
  const url = `${SED_BASE}/cmspwebservice/api/sala-do-futuro-alunos/consulta-notificacao-cmsp?userId=${encodeURIComponent(cdUsuario)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": keys.boletim } });
  const data = await readJson(resp);
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (Array.isArray(data?.notifications)) list = data.notifications;
  else if (Array.isArray(data?.data)) list = data.data;
  const unread = list.filter(item => item?.statusLeitura === false || item?.lido === false || item?.read === false || item?.isRead === false || item?.status === "UNREAD").length;
  return { ok: resp.ok, data, total: list.length, unread };
}

async function fetchAgenda(token, cdUsuarioCurto, env) {
  const keys = getSubscriptionKeys(env);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 30);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `${SED_BASE}/saladofuturobffapi/apiboletim/api/Agenda/GetAgendaPeriodoEscola?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}&anoLetivo=${start.getFullYear()}&dataInicio=${fmt(start)}&dataFim=${fmt(end)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": keys.login, Authorization: `Bearer ${token}` } });
  const data = await readJson(resp);
  return { ok: resp.ok, data, events: unwrapSedList(data) };
}

async function fetchAluno(token, cdUsuarioCurto, env) {
  const keys = getSubscriptionKeys(env);
  const url = `${SED_BASE}/saladofuturobffapi/api/Aluno/ObterAlunoPorCodigo?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": keys.aluno, Authorization: `Bearer ${token}` } });
  return { resp, data: await readJson(resp) };
}

async function fetchTaskDetails(token2, taskId, roomName, captchaToken) {
  let url = `${EDUSP_BASE}/tms/task/${taskId}/apply?preview_mode=false&token_code=null`;
  if (roomName) url += `&room_name=${encodeURIComponent(roomName)}`;
  const apiKey = String(token2 || "").trim();
  if (!apiKey || apiKey === "null" || apiKey === "undefined") return { resp: { ok: false, status: 400 }, data: { erro: "API_KEY_AUSENTE", detalhe: "Token EduSP ausente." } };
  const headers = new Headers({
    "accept": "application/json", "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7", "content-type": "application/json", "x-api-platform": "webclient", "x-api-realm": "edusp",
    "origin": "https://saladofuturo.educacao.sp.gov.br", "referer": "https://saladofuturo.educacao.sp.gov.br/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
  });
  headers.set("x-api-key", apiKey);
  if (captchaToken) headers.set("x-captcha-token", String(captchaToken).trim());
  const resp = await fetch(url, { method: "GET", headers });
  return { resp, data: await readJson(resp) };
}

async function submitTaskAnswers(token2, taskId, roomName, answers, captchaToken, accessedOn, executedOn) {
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const body = {
    task_id: taskId, room_name: roomName || "", answers: answers,
    accessed_on: accessedOn ?? "room", executed_on: executedOn ?? nowIso,
  };
  const baseHeaders = {
    Accept: "application/json", "Content-Type": "application/json", "User-Agent": UPSTREAM_HEADERS["User-Agent"],
    "Accept-Language": UPSTREAM_HEADERS["Accept-Language"],
    Origin: UPSTREAM_HEADERS.Origin, Referer: UPSTREAM_HEADERS.Referer,
    "x-api-platform": "webclient", "x-api-realm": "edusp", "x-api-key": token2,
  };
  if (captchaToken) baseHeaders["x-captcha-token"] = captchaToken;

  // Mesma querystring usada na leitura da tarefa (fetchTaskDetails), que sabemos funcionar.
  // Alguns gateways (Azure APIM / ip.tv) só casam a rota certa quando a querystring bate.
  const applyQS = `?preview_mode=false&token_code=null${roomName ? `&room_name=${encodeURIComponent(roomName)}` : ""}`;

  // Lista de combinações candidatas (endpoint + método). Tentamos todas e guardamos
  // o diagnóstico de cada uma, porque a API do EDUSP para envio de respostas não é
  // documentada publicamente — precisamos descobrir empiricamente qual bate.
  const attempts = [
    { url: `${EDUSP_BASE}/tms/task/${taskId}/answer`, method: "POST" },
    { url: `${EDUSP_BASE}/tms/task/${taskId}/apply${applyQS}`, method: "POST" },
    { url: `${EDUSP_BASE}/tms/task/${taskId}/apply${applyQS}`, method: "PUT" },
    { url: `${EDUSP_BASE}/tms/task/${taskId}/answer`, method: "PUT" },
    { url: `${EDUSP_BASE}/tms/answer`, method: "POST" },
  ];

  const log = [];
  for (const { url, method } of attempts) {
    try {
      const resp = await fetch(url, { method, headers: baseHeaders, body: JSON.stringify(body) });
      const data = await readJson(resp);
      log.push({ url, method, status: resp.status, ok: resp.ok, data });
      if (resp.ok) return { resp, data, url, attempts: log };
    } catch (err) {
      log.push({ url, method, status: 0, ok: false, erro: String(err) });
    }
  }

  // Nenhuma tentativa deu certo: devolve a mais "informativa" (status diferente de 404/405,
  // que costuma indicar que a rota existe mas algo no payload/auth está errado) para ajudar
  // a diagnosticar sem precisar de DevTools.
  const informative = log.find(a => a.status && a.status !== 404 && a.status !== 405) || log[log.length - 1] || null;
  return {
    resp: { ok: false, status: informative?.status || 500 },
    data: informative?.data ?? informative?.erro ?? null,
    url: informative?.url || attempts[attempts.length - 1].url,
    attempts: log,
  };
}

function stripHtmlServer(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ").trim();
}

async function handleGroqHelp(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: "Corpo inválido." }, 400); }
  const question = body?.question || {};
  const statement = stripHtmlServer(question.statement ?? question.enunciado ?? question.texto ?? question.question ?? question.text ?? "");
  if (!statement) return jsonResponse({ erro: "Enunciado ausente." }, 400);
  const rawOptions = question.options ?? question.alternativas ?? question.opcoes ?? null;
  let options = [];
  if (Array.isArray(rawOptions)) options = rawOptions;
  else if (rawOptions && typeof rawOptions === "object") options = Object.values(rawOptions);
  const optionsText = options.map((opt, index) => {
    const id = opt?.id ?? opt?.codigo ?? index;
    const text = stripHtmlServer(opt?.statement ?? opt?.texto ?? opt?.text ?? opt?.enunciado ?? opt?.label ?? "");
    return `${index + 1}. [${id}] ${text}`;
  }).filter(Boolean).join("\n");
  const type = String(question.type || "desconhecido");
  const prompt = `Você é um tutor escolar do Flash, em português do Brasil. Explique a questão de forma objetiva, didática e adequada ao nível escolar. Não entregue simplesmente a resposta final: explique o conceito e mostre um caminho curto para o aluno chegar à resposta. Se houver alternativas, ajude a comparar/eliminar as opções sem apenas dizer a letra correta. Se houver cálculo, mostre as etapas. Termine com uma dica curta para o aluno conferir a própria resposta.\n\nTipo da questão: ${type}\nEnunciado:\n${statement}\n${optionsText ? `\nAlternativas/itens:\n${optionsText}` : ""}`.trim();
  const apiKey = String(env?.GROQ_API_KEY || GROQ_API_KEY || "").trim();
  if (!apiKey) return jsonResponse({ erro: "GROQ_API_KEY não configurada no Worker." }, 500);
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [
        { role: "system", content: "Você é o Flash IA, um tutor escolar em português do Brasil. Seja claro, curto e didático. Não invente dados." },
        { role: "user", content: prompt }
      ],
      temperature: 0.35,
      max_completion_tokens: 1200
    })
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    const message = data?.error?.message || data?.message || `Groq retornou HTTP ${resp.status}`;
    return jsonResponse({ erro: "Falha na Groq", detalhe: message, upstream_status: resp.status, groq_error: data?.error || null }, resp.status);
  }
  const help = data?.choices?.[0]?.message?.content || "";
  if (!help) return jsonResponse({ erro: "A Groq não retornou texto.", detalhe: data }, 502);
  return jsonResponse({ ok: true, help, model: "openai/gpt-oss-20b" });
}

// =======================================================
// GROQ CHAT (TEXTO E VISÃO)
// =======================================================
async function handleGroqChat(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: "Corpo inválido" }, 400); }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const imageBase64 = typeof body?.image === "string" ? body.image.trim() : "";
  const mime = String(body?.imageMime || "image/jpeg").split(";")[0] || "image/jpeg";
  const apiKey = String(env?.GROQ_API_KEY || GROQ_API_KEY || "").trim();
  if (!apiKey) return jsonResponse({ erro: "GROQ_API_KEY não configurada no Worker." }, 500);
  if (!messages.length && !imageBase64) return jsonResponse({ erro: "Mensagem vazia." }, 400);

  const safeMessages = messages.slice(-12).map(m => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: String(m?.content || "")
  }));
  if (!safeMessages.length) safeMessages.push({ role: "user", content: "Analise a imagem enviada." });

  if (imageBase64) {
    const last = safeMessages[safeMessages.length - 1];
    const text = last.content || "Analise esta imagem e me ajude a estudar.";
    last.content = [
      { type: "text", text },
      { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } }
    ];
  }

  const model = imageBase64 ? "qwen/qwen3.6-27b" : "openai/gpt-oss-20b";
  const payload = {
    model,
    messages: [
      { role: "system", content: "Você é o Flash IA, um tutor escolar em português do Brasil. Explique de forma clara, objetiva e didática. Ao analisar imagens, leia o conteúdo visível, incluindo questões, tabelas e respostas destacadas. Não invente informações que não estejam disponíveis." },
      ...safeMessages
    ],
    temperature: imageBase64 ? 0.35 : 0.65,
    max_completion_tokens: 2048
  };

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  const data = await readJson(resp);
  if (!resp.ok) {
    const message = data?.error?.message || data?.message || `Groq retornou HTTP ${resp.status}`;
    return jsonResponse({ erro: "Falha na Groq", detalhe: message, upstream_status: resp.status, groq_error: data?.error || null }, resp.status);
  }
  const response = data?.choices?.[0]?.message?.content || "Sem resposta";
  return jsonResponse({ ok: true, response, model });
}

// =======================================================
// NOTIFICAÇÕES (EM MEMÓORIA)
// =======================================================
async function handleGetNotifications() {
  return jsonResponse({ ok: true, notifications: [...NOTIFICATIONS_DB].sort((a,b) => String(b.date).localeCompare(String(a.date))) });
}

function adminAllowed(request) {
  return request.headers.get("X-Admin-User") === "1127241606SP";
}

async function handleSaveNotification(request) {
  if (!adminAllowed(request)) return jsonResponse({ erro: "Não autorizado" }, 403);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: "Corpo inválido" }, 400); }
  const title = String(body?.title || "").trim();
  const description = String(body?.description || "").trim();
  if (!title || !description) return jsonResponse({ erro: "Título e descrição são obrigatórios" }, 400);
  const item = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(), title, description, date: new Date().toISOString() };
  NOTIFICATIONS_DB.push(item);
  return jsonResponse({ ok: true, notification: item });
}

async function handleEditNotification(request) {
  if (!adminAllowed(request)) return jsonResponse({ erro: "Não autorizado" }, 403);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonResponse({ erro: "ID ausente" }, 400);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: "Corpo inválido" }, 400); }
  const title = String(body?.title || "").trim();
  const description = String(body?.description || "").trim();
  if (!title || !description) return jsonResponse({ erro: "Título e descrição são obrigatórios" }, 400);
  const index = NOTIFICATIONS_DB.findIndex(n => String(n.id) === String(id));
  if (index < 0) return jsonResponse({ erro: "Notificação não encontrada" }, 404);
  NOTIFICATIONS_DB[index] = { ...NOTIFICATIONS_DB[index], title, description, editedAt: new Date().toISOString() };
  return jsonResponse({ ok: true, notification: NOTIFICATIONS_DB[index] });
}

async function handleDeleteNotification(request, url) {
  if (!adminAllowed(request)) return jsonResponse({ erro: "Não autorizado" }, 403);
  const id = url.searchParams.get("id");
  if (!id) return jsonResponse({ erro: "ID ausente" }, 400);
  const before = NOTIFICATIONS_DB.length;
  NOTIFICATIONS_DB = NOTIFICATIONS_DB.filter(n => String(n.id) !== String(id));
  return jsonResponse({ ok: true, deleted: before !== NOTIFICATIONS_DB.length });
}

// =======================================================
// HANDLERS DAS ROTAS
// =======================================================
async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: "Corpo da requisição inválido" }, 400); }
  const keys = getSubscriptionKeys(env);
  const { usuario, senha } = body || {};
  if (!usuario || !senha) return jsonResponse({ erro: "Informe usuário e senha" }, 400);
  const loginResp = await fetch(`${SED_BASE}/saladofuturobffapi/credenciais/api/LoginCompletoToken`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": keys.login },
    body: JSON.stringify({ user: usuario, senha }),
  });
  const loginData = await readJson(loginResp);
  const dados = loginData?.DadosUsuario || {};
  if (!loginResp.ok || !loginData?.token || !dados) return jsonResponse({ erro: "Usuário ou senha inválidos", detalhe: loginData }, loginResp.status >= 400 ? loginResp.status : 401);
  const token = loginData.token;
  const cdUsuario = Number(dados.CD_USUARIO || 0);
  const username = dados.NM_NICK || loginData?.nick || "";
  const tokenResp = await fetch(`${EDUSP_BASE}/registration/edusp/token`, {
    method: "POST",
    headers: { ...UPSTREAM_HEADERS, "content-type": "application/json", "x-api-platform": "webclient", "x-api-realm": "edusp" },
    body: JSON.stringify({ token }),
  });
  const tokenData = await readJson(tokenResp);
  if (!tokenResp.ok || !tokenData?.auth_token) return jsonResponse({ erro: "Login ok, mas não foi possível abrir a sessão do Sala do Futuro", detalhe: tokenData }, tokenResp.status || 401);
  return jsonResponse({ nome: dados.NAME || "Aluno", apelido: username, email: dados.EMAIL || "", cdUsuario, cdUsuarioCurto: String(Math.trunc(cdUsuario / 10)), token, token2: tokenData.auth_token });
}

async function handleDashboard(request, env) {
  const token2 = getEduApiKey(request);
  const token = request.headers.get("X-Token");
  const cdUsuario = request.headers.get("X-Cd-Usuario");
  const username = request.headers.get("X-Task-User") || "";
  if (!token2 || !cdUsuario) return jsonResponse({ erro: "Cabeçalhos X-Token2 e X-Cd-Usuario são obrigatórios" }, 400);
  const [roomsResult, faltasResult, notificationsResult, alunoResult, agendaResult] = await Promise.all([
    fetchTurmas(token, cdUsuario, env), fetchFaltas(normalizeStudentCode(cdUsuario), env), fetchNotifications(cdUsuario, env),
    token ? fetchAluno(token, normalizeStudentCode(cdUsuario), env) : Promise.resolve({ resp: { ok: false }, data: null }),
    token ? fetchAgenda(token, normalizeStudentCode(cdUsuario), env) : Promise.resolve({ ok: false, events: [] }),
  ]);
  const rooms = roomsResult.rooms;
  const taskResult = await fetchTasks(token2, rooms, username);
  const aluno = alunoResult.data;
  const alunoData = aluno?.data && typeof aluno.data === "object" ? aluno.data : aluno;
  return jsonResponse({
    aluno: alunoData || {}, turmas: rooms, tarefas: taskResult.tasks, pendencias: taskResult.tasks.length,
    faltas: faltasResult.total, mensagensNaoLidas: notificationsResult.unread, mensagens: notificationsResult.total,
    targets: taskResult.targets, tarefasApiOk: taskResult.ok, tarefasApiStatus: taskResult.status,
    agenda: agendaResult.ok ? agendaResult.events : [],
    meta: { turmasApiOk: roomsResult.resp.ok, faltasApiOk: faltasResult.resp.ok, notificationsApiOk: notificationsResult.ok, alunoApiOk: !!alunoResult.resp?.ok, agendaApiOk: !!agendaResult.ok },
  });
}

async function handleStudentRooms(request, env) {
  const url = new URL(request.url);
  const requestedCode = url.searchParams.get("codigoAluno") || request.headers.get("X-Cd-Usuario") || "";
  const code = normalizeStudentCode(requestedCode);
  const token = request.headers.get("X-Token") || "";
  if (!code) return jsonResponse({ ok: false, erro: "Código do aluno ausente", rooms: [], targets: [] }, 400);
  if (!token) return jsonResponse({ ok: false, erro: "Cabeçalho X-Token ausente", rooms: [], targets: [] }, 401);
  try {
    const result = await fetchTurmas(token, code, env);
    if (!result.resp.ok) return jsonResponse({ ok: false, erro: "Não foi possível obter as turmas do aluno.", upstream_status: result.resp.status, upstream: result.data, rooms: [], targets: [] }, result.resp.status);
    const rooms = result.rooms.filter((room) => room.name || room.id !== null);
    const targets = rooms.flatMap((room) => [room.name, room.id === null ? "" : String(room.id)]).filter(Boolean);
    return jsonResponse({ ok: true, codigoAluno: code, rooms, targets });
  } catch (error) {
    return jsonResponse({ ok: false, erro: "Não foi possível obter as turmas do aluno.", detalhe: String(error?.message || error), rooms: [], targets: [] }, 502);
  }
}

async function handleResume(request) {
  const token2 = getEduApiKey(request);
  const token = request.headers.get("X-Token");
  const cdUsuarioCurto = request.headers.get("X-Cd-Usuario") || "";
  const apelido = request.headers.get("X-Task-User") || "";
  if (!token2 || !token) return jsonResponse({ ok: false, erro: "Sessão salva inválida ou expirada" }, 401);
  return jsonResponse({ ok: true, nome: apelido || "Aluno", apelido, token, token2, cdUsuarioCurto, usuario: request.headers.get("X-Usuario") || "" });
}

async function handleTaskDetails(request, url) {
  const token2 = getEduApiKey(request);
  if (!token2) return jsonResponse({ erro: "Cabeçalho X-Token2 ausente" }, 400);
  const taskId = url.searchParams.get("task_id");
  const roomName = url.searchParams.get("room_name") || "";
  const captchaToken = request.headers.get("X-Captcha-Token") || "";
  if (!taskId) return jsonResponse({ erro: "Parâmetro task_id ausente" }, 400);
  if (!captchaToken) return jsonResponse({ erro: "CAPTCHA_REQUIRED", captcha_required: true }, 428);
  const result = await fetchTaskDetails(token2, taskId, roomName, captchaToken);
  if (!result.resp.ok) return jsonResponse({ erro: "Falha ao consultar a atividade", upstream_status: result.resp.status, upstream: result.data }, result.resp.status);
  return jsonResponse(result.data, result.resp.status);
}

async function handleAnswerTask(request) {
  const token2 = getEduApiKey(request);
  if (!token2) return jsonResponse({ erro: "Cabeçalho X-Token2 ausente" }, 400);
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: "Corpo da requisição inválido" }, 400); }
  const { task_id, room_name, answers, captcha_token, accessed_on, executed_on } = body || {};
  const answersIsValid = answers && typeof answers === "object" && !Array.isArray(answers) && Object.keys(answers).length > 0;
  if (!task_id || !answersIsValid) return jsonResponse({ erro: "Parâmetros task_id e answers (objeto question_id -> resposta) são obrigatórios" }, 400);
  const result = await submitTaskAnswers(token2, task_id, room_name, answers, captcha_token || request.headers.get("X-Captcha-Token") || "", accessed_on, executed_on);
  return jsonResponse({ ok: result.resp.ok, status: result.resp.status, data: result.data, endpoint: result.url, attempts: result.attempts || [] }, result.resp.status || 502);
}

// =======================================================
// ROTEADOR PRINCIPAL
// =======================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    try {
      if (path === "/login" && request.method === "POST") return handleLogin(request, env);
      if (path === "/resume" && request.method === "POST") return handleResume(request);
      if (path === "/dashboard") return handleDashboard(request, env);
      if (path === "/captcha/challenge" && request.method === "POST") return handleCaptchaChallenge(request);
      if (path === "/captcha/verify" && request.method === "POST") return handleCaptchaVerify(request);
      if (path === "/student-rooms" && request.method === "GET") return handleStudentRooms(request, env);
      if (path === "/task-details") return handleTaskDetails(request, url);
      if (path === "/answer-task" && request.method === "POST") return handleAnswerTask(request);
      if (path === "/groq-chat" && request.method === "POST") return handleGroqChat(request, env);
      if (path === "/notifications" && request.method === "GET") return handleGetNotifications();
      if (path === "/admin/notification" && request.method === "POST") return handleSaveNotification(request);
      if (path === "/admin/notification" && request.method === "PUT") return handleEditNotification(request);
      if (path === "/admin/notification" && request.method === "DELETE") return handleDeleteNotification(request, url);
      if (path === "/pdf-proxy" && request.method === "GET") return handlePdfProxy(request, url);
      if (path === "/groq-help" && request.method === "POST") return handleGroqHelp(request, env);
      if (path === "/health") return jsonResponse({ ok: true, worker: "sdf", build: WORKER_BUILD });
      return jsonResponse({ erro: "Rota não encontrada" }, 404);
    } catch (error) {
      return jsonResponse({ erro: "Erro interno no Worker", detalhe: String(error) }, 500);
    }
  },
};

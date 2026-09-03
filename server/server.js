import http from "node:http";
import { URL } from "node:url";

// ─── Config ───────────────────────────────────────────────
const SED_BASE = "https://sedintegracoes.educacao.sp.gov.br";
const EDUSP_BASE = "https://edusp-api.ip.tv";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const WORKER_BUILD = "sdf-local-v1";
const SUB_KEY = process.env.SED_SUBSCRIPTION_KEY || "";
const GROQ_KEY = process.env.GROQ_API_KEY || "";

const UPSTREAM_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://saladofuturo.educacao.sp.gov.br",
  Referer: "https://saladofuturo.educacao.sp.gov.br/",
};

const EXTRA_TARGETS = ["1052", "1820", "764"];

// ─── Helpers ──────────────────────────────────────────────
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Token, X-Token2, X-Api-Key, X-Cd-Usuario, X-Task-User, X-Usuario, X-Captcha-Token, X-Captcha-Session, X-Admin-User",
  };
}

function json(data, status = 200) {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Worker-Build": WORKER_BUILD, ...cors() },
    body: JSON.stringify(data),
  };
}

async function readJson(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function numberValue(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function addUnique(arr, v) {
  if (v === null || v === undefined || v === "") return;
  const s = String(v);
  if (!arr.includes(s)) arr.push(s);
}

function normalizeStudentCode(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 9) return String(Math.trunc(Number(digits) / 10));
  return digits;
}

function unwrapList(data) {
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
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase());
}

function roomNameFromDescription(desc) {
  const raw = String(desc || "").trim();
  if (!raw) return "";
  const parts = raw.split(" - ");
  if (parts.length >= 3) {
    const curso = toTitleCase(parts[1].trim());
    let serieRaw = parts[2].trim();
    const m = serieRaw.match(/(MANH|TARD|NOIT|ANUA)/i);
    if (m) serieRaw = serieRaw.slice(0, m.index);
    return `${curso} - ${toTitleCase(serieRaw.trim().replace(/SERIE/gi, "Série"))}`;
  }
  if (parts.length >= 2) return toTitleCase(parts[1].trim());
  return toTitleCase(raw);
}

function normalizeRoom(room) {
  const desc = room?.DescricaoTurma ?? room?.descricaoTurma ?? room?.descricao ?? room?.description ?? "";
  const name = roomNameFromDescription(desc) || String(room?.NomeTurma ?? room?.name ?? room?.topic ?? "").trim();
  return {
    id: room?.CodigoTurma ?? room?.codigoTurma ?? room?.id ?? null,
    numeroClasse: room?.NumeroClasse ?? room?.numeroClasse ?? null,
    identificador: room?.IdentificadorTurma ?? room?.identificadorTurma ?? "",
    descricao: desc,
    name,
    escola: room?.NomeEscola ?? room?.nomeEscola ?? "",
    codigoEscola: room?.CodigoEscola ?? room?.codigoEscola ?? null,
    curso: name ? name.split(" - ")[0] : "",
  };
}

function extractTasks(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of ["tasks", "items", "data", "results", "todo"]) if (Array.isArray(data[k])) return data[k];
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

function findRoomForTask(task, rooms) {
  const text = JSON.stringify(task || "").toLowerCase();
  for (const r of rooms) {
    if (r.name && text.includes(r.name.toLowerCase())) return r.name;
    if (r.id !== null && text.includes(String(r.id))) return r.name;
  }
  return "";
}

function stripHtml(v) {
  return String(v ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ").trim();
}

function getEduApiKey(req) {
  const raw = req.headers["x-token2"] || req.headers["x-api-key"] || "";
  const key = String(raw).trim();
  if (!key || key === "null" || key === "undefined") return "";
  return key;
}

function extractFaltasBimestre(data) {
  const exactKeys = ["faltasBimestreAtual", "FaltasBimestreAtual", "totalFaltasBimestre", "TotalFaltasBimestre", "quantidadeFaltasBimestre", "QuantidadeFaltasBimestre", "totalFaltas", "TotalFaltas", "faltas", "Faltas"];
  const seen = new WeakSet();
  function walk(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) { for (const i of node) { const f = walk(i); if (f !== null) return f; } return null; }
    for (const k of exactKeys) { if (Object.prototype.hasOwnProperty.call(node, k)) { const n = numberValue(node[k]); if (n !== null) return n; } }
    for (const v of Object.values(node)) { const f = walk(v); if (f !== null) return f; }
    return null;
  }
  const explicit = walk(data);
  if (explicit !== null) return explicit;
  let sum = 0, found = false;
  const visited = new WeakSet();
  function sumExact(node) {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) return node.forEach(sumExact);
    for (const [k, v] of Object.entries(node)) {
      if (/^faltas?$/i.test(k)) { const n = numberValue(v); if (n !== null) { sum += n; found = true; } }
      else if (v && typeof v === "object") sumExact(v);
    }
  }
  sumExact(data);
  return found ? sum : null;
}

// ─── SED / EduSP API calls ────────────────────────────────
async function fetchTurmas(token, cdUsuarioCurto) {
  const codigoAluno = normalizeStudentCode(cdUsuarioCurto);
  const url = `${SED_BASE}/saladofuturobffapi/apihubintegracoes/api/v2/Turma/ListarTurmasPorAluno?codigoAluno=${encodeURIComponent(codigoAluno)}`;
  const headers = { ...UPSTREAM_HEADERS, "Ocp-Apim-Subscription-Key": SUB_KEY, "x-product-name": "SalaDoFuturo" };
  if (token) headers.Authorization = `Bearer ${String(token).replace(/^Bearer\s+/i, "")}`;
  const resp = await fetch(url, { headers });
  const data = await readJson(resp);
  return { resp, data, codigoAluno, rooms: unwrapList(data).map(normalizeRoom) };
}

async function fetchAluno(token, cdUsuarioCurto) {
  const url = `${SED_BASE}/saladofuturobffapi/api/Aluno/ObterAlunoPorCodigo?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": SUB_KEY, Authorization: `Bearer ${token}` } });
  return { resp, data: await readJson(resp) };
}

async function fetchAgenda(token, cdUsuarioCurto) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 30);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `${SED_BASE}/saladofuturobffapi/apiboletim/api/Agenda/GetAgendaPeriodoEscola?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}&anoLetivo=${start.getFullYear()}&dataInicio=${fmt(start)}&dataFim=${fmt(end)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": SUB_KEY, Authorization: `Bearer ${token}` } });
  const data = await readJson(resp);
  return { ok: resp.ok, data, events: unwrapList(data) };
}

async function fetchFaltas(cdUsuarioCurto) {
  // Fixed: added /saladofuturobffapi prefix (was missing in original worker)
  const url = `${SED_BASE}/saladofuturobffapi/apiboletim/api/Frequencia/GetFaltasBimestreAtual?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Content-Type": "application/json", "ocp-apim-subscription-key": SUB_KEY } });
  const data = await readJson(resp);
  return { resp, data, total: extractFaltasBimestre(data) };
}

async function fetchBoletim(token, cdUsuarioCurto) {
  const year = new Date().getFullYear();
  const url = `${SED_BASE}/saladofuturobffapi/apiboletim/api/Boletim/GetBoletimCompleto?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}&anoLetivo=${year}&codigoTurma=0`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": SUB_KEY, Authorization: `Bearer ${token}` } });
  const data = await readJson(resp);
  return { resp, data };
}

async function fetchFrequencia(token, cdUsuarioCurto) {
  const year = new Date().getFullYear();
  const urls = [
    `${SED_BASE}/saladofuturobffapi/apiboletim/api/Frequencia/ConsultaFrequenciaBimestre?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}&anoLetivo=${year}&bimestre=1&somenteAtivo=0`,
    `${SED_BASE}/saladofuturobffapi/apiboletim/api/Frequencia/GetFaltasBimestreAtual?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}`,
    `${SED_BASE}/saladofuturobffapi/apiboletim/api/Fechamento/ConsultaFechamentoComparativo?codigoAluno=${encodeURIComponent(cdUsuarioCurto)}&anoLetivo=${year}&somenteAtivo=0&tipoFechamento=10&codigoDisciplina=0`,
  ];
  const results = await Promise.allSettled(
    urls.map(async (u) => {
      const resp = await fetch(u, { headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": SUB_KEY, Authorization: `Bearer ${token}` } });
      return { ok: resp.ok, data: await readJson(resp) };
    })
  );
  const [freq, faltas, fechamento] = results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, data: null }));
  return {
    frequencia: freq.data,
    faltas: faltas.data,
    faltasTotal: extractFaltasBimestre(faltas.data),
    fechamento: fechamento.data,
    ok: freq.ok || faltas.ok || fechamento.ok,
  };
}

async function fetchNotifications(cdUsuario) {
  const url = `${SED_BASE}/cmspwebservice/api/sala-do-futuro-alunos/consulta-notificacao-cmsp?userId=${encodeURIComponent(cdUsuario)}`;
  const resp = await fetch(url, { headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": SUB_KEY } });
  const data = await readJson(resp);
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (Array.isArray(data?.notifications)) list = data.notifications;
  else if (Array.isArray(data?.data)) list = data.data;
  const unread = list.filter((i) => i?.statusLeitura === false || i?.lido === false || i?.read === false || i?.isRead === false || i?.status === "UNREAD").length;
  return { ok: resp.ok, data, total: list.length, unread };
}

async function fetchEduspRoomTargets(token2) {
  const targets = [];
  try {
    const resp = await fetch(`${EDUSP_BASE}/room/user?list_all=true&with_cards=true`, {
      headers: { ...UPSTREAM_HEADERS, "content-type": "application/json", "x-api-platform": "webclient", "x-api-realm": "edusp", "x-api-key": token2 },
    });
    if (!resp.ok) return targets;
    const data = await readJson(resp);
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    for (const room of rooms) {
      addUnique(targets, room?.name);
      const cats = Array.isArray(room?.group_categories) ? room.group_categories : [];
      for (const cat of cats) addUnique(targets, cat?.id);
    }
  } catch {}
  return targets;
}

async function fetchTasksForTargets(token2, targets) {
  const params = new URLSearchParams();
  params.set("expired_only", "false"); params.set("limit", "100"); params.set("offset", "0");
  params.set("filter_expired", "true"); params.set("is_exam", "false"); params.set("with_answer", "true");
  params.set("is_essay", "false"); params.append("answer_statuses", "draft"); params.append("answer_statuses", "pending");
  params.set("with_apply_moment", "true");
  for (const t of targets) params.append("publication_target", t);
  const resp = await fetch(`${EDUSP_BASE}/tms/task/todo?${params.toString()}`, {
    headers: { ...UPSTREAM_HEADERS, "content-type": "application/json", "x-api-platform": "webclient", "x-api-realm": "edusp", "x-api-key": token2 },
  });
  return { resp, data: await readJson(resp) };
}

async function fetchTasks(token2, rooms, username) {
  const baseTargets = [];
  for (const t of await fetchEduspRoomTargets(token2)) addUnique(baseTargets, t);
  for (const room of rooms) {
    if (!room.name) continue;
    addUnique(baseTargets, room.name);
    if (username) addUnique(baseTargets, `${room.name}:${username}-sp`);
  }
  for (const t of EXTRA_TARGETS) addUnique(baseTargets, t);
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
  return { ok: result.resp.ok, status: result.resp.status, tasks, targets: baseTargets };
}

async function fetchTaskDetails(token2, taskId, roomName, captchaToken) {
  let url = `${EDUSP_BASE}/tms/task/${taskId}/apply?preview_mode=false&token_code=null`;
  if (roomName) url += `&room_name=${encodeURIComponent(roomName)}`;
  const headers = new Headers({
    accept: "application/json", "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7", "content-type": "application/json",
    "x-api-platform": "webclient", "x-api-realm": "edusp",
    origin: UPSTREAM_HEADERS.Origin, referer: UPSTREAM_HEADERS.Referer,
    "user-agent": UPSTREAM_HEADERS["User-Agent"],
  });
  headers.set("x-api-key", token2);
  if (captchaToken) headers.set("x-captcha-token", String(captchaToken).trim());
  const resp = await fetch(url, { method: "GET", headers });
  return { resp, data: await readJson(resp) };
}

// ─── Route handlers ──────────────────────────────────────
async function handleLogin(body) {
  const { usuario, senha } = body || {};
  if (!usuario || !senha) return json({ erro: "Informe usuário e senha" }, 400);

  const loginResp = await fetch(`${SED_BASE}/saladofuturobffapi/credenciais/api/LoginCompletoToken`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": SUB_KEY },
    body: JSON.stringify({ user: usuario, senha }),
  });
  const loginData = await readJson(loginResp);
  const dados = loginData?.DadosUsuario || {};
  if (!loginResp.ok || !loginData?.token || !dados)
    return json({ erro: "Usuário ou senha inválidos", detalhe: loginData }, loginResp.status >= 400 ? loginResp.status : 401);

  const token = loginData.token;
  const cdUsuario = Number(dados.CD_USUARIO || 0);
  const username = dados.NM_NICK || loginData?.nick || "";

  const tokenResp = await fetch(`${EDUSP_BASE}/registration/edusp/token`, {
    method: "POST",
    headers: { ...UPSTREAM_HEADERS, "content-type": "application/json", "x-api-platform": "webclient", "x-api-realm": "edusp" },
    body: JSON.stringify({ token }),
  });
  const tokenData = await readJson(tokenResp);
  if (!tokenResp.ok || !tokenData?.auth_token)
    return json({ erro: "Login ok, mas não foi possível abrir a sessão do Sala do Futuro", detalhe: tokenData }, tokenResp.status || 401);

  return json({ nome: dados.NAME || "Aluno", apelido: username, email: dados.EMAIL || "", cdUsuario, cdUsuarioCurto: String(Math.trunc(cdUsuario / 10)), token, token2: tokenData.auth_token });
}

async function handleResume(req) {
  const token2 = getEduApiKey(req);
  const token = req.headers["x-token"] || "";
  const cdUsuarioCurto = req.headers["x-cd-usuario"] || "";
  const apelido = req.headers["x-task-user"] || "";
  if (!token2 || !token) return json({ ok: false, erro: "Sessão salva inválida ou expirada" }, 401);
  return json({ ok: true, nome: apelido || "Aluno", apelido, token, token2, cdUsuarioCurto, usuario: req.headers["x-usuario"] || "" });
}

async function handleDashboard(req) {
  const token2 = getEduApiKey(req);
  const token = req.headers["x-token"] || "";
  const cdUsuario = req.headers["x-cd-usuario"] || "";
  const username = req.headers["x-task-user"] || "";
  if (!token2 || !cdUsuario) return json({ erro: "Cabeçalhos X-Token2 e X-Cd-Usuario são obrigatórios" }, 400);

  const cdCurto = normalizeStudentCode(cdUsuario);
  const [roomsResult, faltasResult, notificationsResult, alunoResult, agendaResult] = await Promise.all([
    fetchTurmas(token, cdCurto),
    fetchFaltas(cdCurto),
    fetchNotifications(cdUsuario),
    token ? fetchAluno(token, cdCurto) : Promise.resolve({ resp: { ok: false }, data: null }),
    token ? fetchAgenda(token, cdCurto) : Promise.resolve({ ok: false, events: [] }),
  ]);
  const rooms = roomsResult.rooms;
  const taskResult = await fetchTasks(token2, rooms, username);
  const aluno = alunoResult.data;
  const alunoData = aluno?.data && typeof aluno.data === "object" ? aluno.data : aluno;

  return json({
    aluno: alunoData || {},
    turmas: rooms,
    tarefas: taskResult.tasks,
    pendencias: taskResult.tasks.length,
    faltas: faltasResult.total,
    mensagensNaoLidas: notificationsResult.unread,
    mensagens: notificationsResult.total,
    targets: taskResult.targets,
    tarefasApiOk: taskResult.ok,
    tarefasApiStatus: taskResult.status,
    agenda: agendaResult.ok ? agendaResult.events : [],
    meta: {
      turmasApiOk: roomsResult.resp.ok,
      faltasApiOk: faltasResult.resp.ok,
      notificationsApiOk: notificationsResult.ok,
      alunoApiOk: !!alunoResult.resp?.ok,
      agendaApiOk: !!agendaResult.ok,
    },
  });
}

async function handleStudentRooms(req, url) {
  const code = normalizeStudentCode(url.searchParams.get("codigoAluno") || req.headers["x-cd-usuario"] || "");
  const token = req.headers["x-token"] || "";
  if (!code) return json({ ok: false, erro: "Código do aluno ausente", rooms: [], targets: [] }, 400);
  if (!token) return json({ ok: false, erro: "Cabeçalho X-Token ausente", rooms: [], targets: [] }, 401);
  const result = await fetchTurmas(token, code);
  if (!result.resp.ok)
    return json({ ok: false, erro: "Não foi possível obter as turmas do aluno.", upstream_status: result.resp.status, upstream: result.data, rooms: [], targets: [] }, result.resp.status);
  const rooms = result.rooms.filter((r) => r.name || r.id !== null);
  const targets = rooms.flatMap((r) => [r.name, r.id === null ? "" : String(r.id)]).filter(Boolean);
  return json({ ok: true, codigoAluno: code, rooms, targets });
}

async function handleBoletim(req) {
  const token = req.headers["x-token"] || "";
  const cdUsuario = req.headers["x-cd-usuario"] || "";
  if (!token || !cdUsuario) return json({ erro: "Cabeçalhos X-Token e X-Cd-Usuario são obrigatórios" }, 400);
  const result = await fetchBoletim(token, normalizeStudentCode(cdUsuario));
  return json(result.data, result.resp.status);
}

async function handlePresenca(req) {
  const token = req.headers["x-token"] || "";
  const cdUsuario = req.headers["x-cd-usuario"] || "";
  if (!token || !cdUsuario) return json({ erro: "Cabeçalhos X-Token e X-Cd-Usuario são obrigatórios" }, 400);
  const result = await fetchFrequencia(token, normalizeStudentCode(cdUsuario));
  return json(result);
}

async function handleTarefas(req) {
  const token2 = getEduApiKey(req);
  const token = req.headers["x-token"] || "";
  const cdUsuario = req.headers["x-cd-usuario"] || "";
  const username = req.headers["x-task-user"] || "";
  if (!token2 || !cdUsuario) return json({ erro: "Cabeçalhos X-Token2 e X-Cd-Usuario são obrigatórios" }, 400);
  const roomsResult = await fetchTurmas(token, normalizeStudentCode(cdUsuario));
  const result = await fetchTasks(token2, roomsResult.rooms, username);
  return json({ tasks: result.tasks, ok: result.ok, targets: result.targets });
}

async function handlePdfProxy(url) {
  const target = url.searchParams.get("url") || "";
  if (!target) return { status: 400, headers: cors(), body: "Parâmetro url ausente" };
  let targetUrl;
  try { targetUrl = new URL(target); } catch { return { status: 400, headers: cors(), body: "URL inválida" }; }
  if (targetUrl.protocol !== "https:" || targetUrl.hostname !== "raw.githubusercontent.com")
    return { status: 403, headers: cors(), body: "Domínio não permitido" };
  const resp = await fetch(targetUrl.toString(), { headers: { Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8" } });
  const headers = { ...cors(), "Content-Type": resp.headers.get("content-type") || "application/pdf", "Cache-Control": "public, max-age=86400", "Content-Disposition": "inline" };
  const buf = Buffer.from(await resp.arrayBuffer());
  return { status: resp.status, headers, body: buf };
}

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

async function handleCaptchaChallenge(req) {
  const token2 = getEduApiKey(req);
  if (!token2) return json({ erro: "Cabeçalho X-Token2 ausente" }, 400);
  let body = { realm: "edusp", type: "image" };
  try { const incoming = typeof req.body === "string" ? JSON.parse(req.body) : req.body; if (incoming) body = { ...body, ...incoming }; } catch {}
  const sessionKey = crypto.randomUUID().replace(/-/g, "");
  const urls = [`${EDUSP_BASE}/captcha/challenge`, `${EDUSP_BASE}/captcha/challenge?realm=edusp`];
  let last = null;
  for (const u of urls) {
    try {
      const init = { method: "POST", headers: captchaHeaders(token2, sessionKey), body: JSON.stringify(body) };
      if (u.includes("?realm=")) delete init.body;
      const resp = await fetch(u, init);
      const data = await readJson(resp);
      last = { resp, data };
      if (resp.ok) {
        return json({
          ...data,
          challengeId: data?.challengeId ?? data?.challenge_id ?? data?.id ?? data?.data?.challenge_id ?? data?.data?.id,
          image: data?.challenge?.image ?? data?.image ?? data?.data?.image ?? data?.data?.challenge?.image,
          sessionKey,
          captchaCookie: resp.headers.get("set-cookie") || "",
        }, resp.status);
      }
    } catch {}
  }
  return json({ erro: "Não foi possível carregar o CAPTCHA.", detalhe: last?.data || null }, last?.resp?.status || 502);
}

async function handleCaptchaVerify(req) {
  const token2 = getEduApiKey(req);
  if (!token2) return json({ erro: "Cabeçalho X-Token2 ausente" }, 400);
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch { return json({ erro: "Corpo do CAPTCHA inválido" }, 400); }
  const payload = body?.payload || {};
  if (!payload.challengeId || !payload.answer) return json({ erro: "challengeId e answer são obrigatórios" }, 400);
  const sessionKey = body?.sessionKey || req.headers["x-captcha-session"] || "";
  const captchaCookie = body?.captchaCookie || "";
  const headers = captchaHeaders(token2, sessionKey);
  if (captchaCookie) headers.Cookie = String(captchaCookie);
  const resp = await fetch(`${EDUSP_BASE}/captcha/verify`, {
    method: "POST", headers,
    body: JSON.stringify({ type: "image", realm: "edusp", payload: { challengeId: payload.challengeId, answer: String(payload.answer).trim() } }),
  });
  const data = await readJson(resp);
  const token = data?.token || data?.captcha_token || data?.captchaToken || data?.data?.token || data?.data?.captcha_token || "";
  return json({ ...data, token, valid: Boolean(token || data?.valid) }, resp.status);
}

async function handleTaskDetails(req, url) {
  const token2 = getEduApiKey(req);
  if (!token2) return json({ erro: "Cabeçalho X-Token2 ausente" }, 400);
  const taskId = url.searchParams.get("task_id");
  const roomName = url.searchParams.get("room_name") || "";
  const captchaToken = req.headers["x-captcha-token"] || "";
  if (!taskId) return json({ erro: "Parâmetro task_id ausente" }, 400);
  if (!captchaToken) return json({ erro: "CAPTCHA_REQUIRED", captcha_required: true }, 428);
  const result = await fetchTaskDetails(token2, taskId, roomName, captchaToken);
  if (!result.resp.ok) return json({ erro: "Falha ao consultar a atividade", upstream_status: result.resp.status, upstream: result.data }, result.resp.status);
  return json(result.data, result.resp.status);
}

async function handleGroqChat(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const imageBase64 = typeof body?.image === "string" ? body.image.trim() : "";
  const mime = String(body?.imageMime || "image/png");
  const apiKey = GROQ_KEY;
  if (!apiKey) return json({ erro: "GROQ_API_KEY não configurada." }, 500);

  const msgBody = [];
  for (const m of messages) {
    if (m.role === "user" && imageBase64) {
      msgBody.push({ role: "user", content: [{ type: "text", text: m.content || "" }, { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } }] });
    } else {
      msgBody.push({ role: m.role, content: m.content || "" });
    }
  }

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "meta/llama-4-scout-17b-16e-instruct", messages: msgBody, temperature: 0.5, max_completion_tokens: 1500 }),
  });
  const data = await readJson(resp);
  if (!resp.ok) return json({ erro: "Falha na Groq", detalhe: data?.error?.message || data?.message || `HTTP ${resp.status}` }, resp.status);
  const reply = data?.choices?.[0]?.message?.content || "";
  if (!reply) return json({ erro: "A Groq não retornou texto.", detalhe: data }, 502);
  return json({ reply, model: "meta/llama-4-scout-17b-16e-instruct" });
}

async function handleGroqHelp(body) {
  const question = body?.question || {};
  const statement = stripHtml(question.statement ?? question.enunciado ?? question.texto ?? question.question ?? question.text ?? "");
  if (!statement) return json({ erro: "Enunciado ausente." }, 400);
  const rawOptions = question.options ?? question.alternativas ?? question.opcoes ?? null;
  let options = [];
  if (Array.isArray(rawOptions)) options = rawOptions;
  else if (rawOptions && typeof rawOptions === "object") options = Object.values(rawOptions);
  const optionsText = options.map((opt, i) => `${i + 1}. ${stripHtml(opt?.statement ?? opt?.texto ?? opt?.text ?? opt?.enunciado ?? opt?.label ?? "")}`).filter(Boolean).join("\n");
  const type = String(question.type || "desconhecido");
  const prompt = `Você é um tutor escolar do Flash, em português do Brasil. Explique a questão de forma objetiva, didática e adequada ao nível escolar. Não entregue simplesmente a resposta final: explique o conceito e mostre um caminho curto para o aluno chegar à resposta. Se houver alternativas, ajude a comparar/eliminar as opções sem apenas dizer a letra correta. Se houver cálculo, mostre as etapas. Termine com uma dica curta para o aluno conferir a própria resposta.\n\nTipo da questão: ${type}\nEnunciado:\n${statement}\n${optionsText ? `\nAlternativas/itens:\n${optionsText}` : ""}`.trim();
  const apiKey = GROQ_KEY;
  if (!apiKey) return json({ erro: "GROQ_API_KEY não configurada no Worker." }, 500);
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "openai/gpt-oss-20b", messages: [{ role: "system", content: "Você é o Flash IA, um tutor escolar em português do Brasil. Seja claro, curto e didático. Não invente dados." }, { role: "user", content: prompt }], temperature: 0.35, max_completion_tokens: 1200 }),
  });
  const data = await readJson(resp);
  if (!resp.ok) return json({ erro: "Falha na Groq", detalhe: data?.error?.message || data?.message || `HTTP ${resp.status}` }, resp.status);
  const help = data?.choices?.[0]?.message?.content || "";
  if (!help) return json({ erro: "A Groq não retornou texto.", detalhe: data }, 502);
  return json({ ok: true, help, model: "openai/gpt-oss-20b" });
}

// ─── HTTP Server ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors());
    return res.end();
  }

  // Read body for POST
  let body = null;
  if (req.method === "POST" || req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    try { body = JSON.parse(raw); } catch { body = raw; }
    req.body = body;
  }

  try {
    let result;
    if (path === "/login" && req.method === "POST") result = await handleLogin(body);
    else if (path === "/resume" && req.method === "POST") result = await handleResume(req);
    else if (path === "/dashboard") result = await handleDashboard(req);
    else if (path === "/captcha/challenge" && req.method === "POST") result = await handleCaptchaChallenge(req);
    else if (path === "/captcha/verify" && req.method === "POST") result = await handleCaptchaVerify(req);
    else if (path === "/student-rooms" && req.method === "GET") result = await handleStudentRooms(req, url);
    else if (path === "/task-details") result = await handleTaskDetails(req, url);
    else if (path === "/answer-task" && req.method === "POST") result = json({ erro: "answer-task não implementado neste backend" }, 501);
    else if (path === "/groq-chat" && req.method === "POST") result = await handleGroqChat(body);
    else if (path === "/groq-help" && req.method === "POST") result = await handleGroqHelp(body);
    else if (path === "/pdf-proxy" && req.method === "GET") result = await handlePdfProxy(url);
    else if (path === "/boletim") result = await handleBoletim(req);
    else if (path === "/presenca") result = await handlePresenca(req);
    else if (path === "/tarefas") result = await handleTarefas(req);
    else if (path === "/health") result = json({ ok: true, worker: "sdf-local", build: WORKER_BUILD });
    else result = json({ erro: "Rota não encontrada" }, 404);

    if (result instanceof Promise) result = await result;

    if (Buffer.isBuffer(result.body)) {
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } else {
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json", ...cors() });
    res.end(JSON.stringify({ erro: "Erro interno no servidor", detalhe: String(err?.message || err) }));
  }
});

const PORT = 8001;
server.listen(PORT, () => console.log(`SED local worker listening on :${PORT}`));

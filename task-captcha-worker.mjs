const EDUSP_BASE = "https://edusp-api.ip.tv";
const ALLOWED_ORIGIN = "https://sed-gg.vercel.app";
const PREVIEW_ORIGIN = /^https:\/\/sed-[a-z0-9-]+\.vercel\.app$/i;
const UPSTREAM_ORIGIN = "https://saladofuturo.educacao.sp.gov.br";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === ALLOWED_ORIGIN || PREVIEW_ORIGIN.test(origin);
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, X-Token2, X-Api-Key, X-Captcha-Token, X-Captcha-Session, X-Captcha-Cookie",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
  };
}

function json(request, payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request), ...extraHeaders },
  });
}

function apiKey(request) {
  return String(request.headers.get("X-Token2") || request.headers.get("X-Api-Key") || "").trim();
}

function captchaHeaders(sessionKey = "", cookie = "") {
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    Origin: UPSTREAM_ORIGIN,
    Referer: `${UPSTREAM_ORIGIN}/`,
    "User-Agent": USER_AGENT,
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    ...(sessionKey ? { "x-session-key": sessionKey } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function taskHeaders(key, sessionKey = "", cookie = "", captchaToken = "") {
  return {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json",
    Origin: UPSTREAM_ORIGIN,
    Referer: `${UPSTREAM_ORIGIN}/`,
    "User-Agent": USER_AGENT,
    "x-api-platform": "webclient",
    "x-api-realm": "edusp",
    "x-api-key": key,
    ...(captchaToken ? { "x-captcha-token": captchaToken } : {}),
    ...(sessionKey ? { "x-session-key": sessionKey } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function parseJson(text) {
  try { return text ? JSON.parse(text) : null; } catch { return { raw: text }; }
}

async function readBody(response) {
  return parseJson(await response.text());
}

function cookiesFromResponse(response) {
  const headers = response.headers;
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") || ""];
  return values.flatMap((value) => String(value).split(/,(?=[^;,=]+=)/))
    .map((value) => value.trim().split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function mergeCookies(...lists) {
  const map = new Map();
  for (const list of lists) for (const part of String(list || "").split(";")) {
    const item = part.trim();
    const index = item.indexOf("=");
    if (index > 0) map.set(item.slice(0, index), item.slice(index + 1));
  }
  return Array.from(map, ([name, value]) => `${name}=${value}`).join("; ");
}

function cookieFromData(data) {
  if (!data || typeof data !== "object") return "";
  const nested = data.data && typeof data.data === "object" ? data.data : {};
  return String(data.captchaCookie || data.captcha_cookie || data.cookie || nested.captchaCookie || nested.captcha_cookie || nested.cookie || "").trim();
}

function newSessionKey() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function handleChallenge(request) {
  let body = { realm: "edusp", type: "image" };
  try {
    const incoming = await request.json();
    if (incoming && typeof incoming === "object") body = { ...body, ...incoming };
  } catch {}
  const session = String(body.sessionKey || request.headers.get("X-Captcha-Session") || newSessionKey()).trim();
  delete body.sessionKey;
  if (!/^[A-Za-z0-9._:-]{1,512}$/.test(session)) return json(request, { erro: "Sessão temporária do CAPTCHA inválida." }, 400);
  try {
    const response = await fetch(`${EDUSP_BASE}/captcha/challenge`, {
      method: "POST",
      headers: captchaHeaders(session),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await readBody(response);
    if (!response.ok) return json(request, { erro: "Não foi possível carregar o CAPTCHA.", detalhe: data }, response.status);
    const nested = data?.challenge && typeof data.challenge === "object" ? data.challenge : {};
    const nestedData = data?.data && typeof data.data === "object" ? data.data : {};
    const nestedChallenge = nestedData.challenge && typeof nestedData.challenge === "object" ? nestedData.challenge : {};
    return json(request, {
      ...(data && typeof data === "object" && !Array.isArray(data) ? data : { data }),
      challengeId: data?.challengeId ?? data?.challenge_id ?? data?.id ?? nestedData.challengeId ?? nestedData.challenge_id ?? nestedData.id ?? nested.challengeId ?? nested.challenge_id ?? nestedChallenge.challengeId ?? nestedChallenge.challenge_id,
      image: nested.image ?? data?.image ?? nestedData.image ?? nestedChallenge.image,
      sessionKey: session,
      captchaCookie: mergeCookies(cookieFromData(data), cookiesFromResponse(response)),
    }, response.status, { "X-Task-Proxy": "cloudflare-task-captcha" });
  } catch (error) {
    return json(request, { erro: "Não foi possível conectar ao serviço de CAPTCHA.", detalhe: String(error?.message || error) }, 502);
  }
}

async function handleVerify(request) {
  let body;
  try { body = await request.json(); } catch { return json(request, { erro: "Corpo do CAPTCHA inválido." }, 400); }
  const payload = body?.payload || {};
  const challengeId = String(payload.challengeId ?? payload.challenge_id ?? "").trim();
  const answer = String(payload.answer ?? "").trim();
  const session = String(body?.sessionKey || request.headers.get("X-Captcha-Session") || "").trim();
  const cookie = String(body?.captchaCookie || request.headers.get("X-Captcha-Cookie") || "").trim();
  if (!challengeId || !answer || !session) return json(request, { erro: "challengeId e answer são obrigatórios, assim como a sessão do CAPTCHA." }, 400);
  if (challengeId.length > 512 || answer.length > 128 || session.length > 512 || cookie.length > 8192) return json(request, { erro: "Dados do CAPTCHA excedem o limite permitido." }, 400);
  try {
    const response = await fetch(`${EDUSP_BASE}/captcha/verify`, {
      method: "POST",
      headers: captchaHeaders(session, cookie),
      body: JSON.stringify({ type: "image", realm: "edusp", payload: { challengeId, answer } }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    const data = await readBody(response);
    if (!response.ok) return json(request, { erro: response.status === 401 ? "A plataforma recusou a sessão do CAPTCHA. Gere um novo desafio e tente novamente." : "O código do CAPTCHA não foi aceito.", upstream_status: response.status, upstream: data, token: "", valid: false }, response.status);
    const token = data?.token || data?.captcha_token || data?.captchaToken || data?.data?.token || data?.data?.captcha_token || data?.data?.captchaToken || "";
    if (response.status >= 300 && response.status < 400) return json(request, { erro: "O serviço de CAPTCHA redirecionou a validação. Gere um novo desafio.", upstream_status: response.status, valid: false }, 502);
    return json(request, {
      ...(data && typeof data === "object" && !Array.isArray(data) ? data : { data }),
      token,
      valid: Boolean(token || data?.valid),
      sessionKey: session,
      captchaCookie: mergeCookies(cookie, cookieFromData(data), cookiesFromResponse(response)),
    }, response.status, { "X-Task-Proxy": "cloudflare-task-captcha" });
  } catch (error) {
    return json(request, { erro: "Não foi possível conectar ao serviço de CAPTCHA.", detalhe: String(error?.message || error), valid: false }, 502);
  }
}

async function handleTaskDetails(request, key, url) {
  const taskId = String(url.searchParams.get("task_id") || "").trim();
  const roomName = String(url.searchParams.get("room_name") || "").trim();
  const captchaToken = String(request.headers.get("X-Captcha-Token") || "").trim();
  const session = String(request.headers.get("X-Captcha-Session") || "").trim();
  const cookie = String(request.headers.get("X-Captcha-Cookie") || "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(taskId)) return json(request, { erro: "Identificador da atividade inválido." }, 400);
  if (!roomName || roomName.length > 512) return json(request, { erro: "Sala da atividade não identificada." }, 400);
  if (!captchaToken || captchaToken.length > 4096) return json(request, { erro: "CAPTCHA_REQUIRED: gere e valide um CAPTCHA novo." }, 428);
  if (session.length > 512 || cookie.length > 8192) return json(request, { erro: "Sessão temporária do CAPTCHA inválida." }, 400);
  const query = new URLSearchParams({ preview_mode: "false", token_code: "null", room_name: roomName });
  const upstreamUrl = `${EDUSP_BASE}/tms/task/${encodeURIComponent(taskId)}/apply?${query}`;
  try {
    // Um único apply: a EduSP pode consumir o token mesmo quando rejeita a consulta.
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: taskHeaders(key, session, cookie, captchaToken),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const data = await readBody(response);
    if (!response.ok) return json(request, { erro: `Falha ao consultar a atividade (HTTP ${response.status}).`, upstream_status: response.status, upstream: data }, response.status, { "X-Task-Proxy": "cloudflare-task-captcha" });
    return json(request, data, response.status, { "X-Task-Proxy": "cloudflare-task-captcha" });
  } catch (error) {
    return json(request, { erro: "Falha ao consultar a atividade (HTTP 502).", detalhe: String(error?.message || error) }, 502);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = corsHeaders(request);
    const origin = request.headers.get("Origin") || "";
    if (origin && origin !== ALLOWED_ORIGIN && !PREVIEW_ORIGIN.test(origin)) return json(request, { erro: "Origem não autorizada." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/health" && request.method === "GET") return json(request, { ok: true, worker: "sdf-task-captcha", build: "sdf-task-captcha-v1" });
    const key = apiKey(request);
    if (!key || key.length > 4096) return json(request, { erro: "Cabeçalho X-Token2 ausente. Faça login novamente." }, 400);
    if (url.pathname === "/captcha/challenge" && request.method === "POST") return handleChallenge(request);
    if (url.pathname === "/captcha/verify" && request.method === "POST") return handleVerify(request);
    if (url.pathname === "/task-details" && request.method === "GET") return handleTaskDetails(request, key, url);
    return json(request, { erro: "Rota não encontrada." }, 404);
  },
};

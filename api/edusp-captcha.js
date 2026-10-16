// Proxy do CAPTCHA da EduSP.
// O desafio, a validação e o apply da atividade precisam sair do mesmo egress
// para que a EduSP possa associar o token à sessão/IP que o validou.
const EDUSP_BASE = "https://edusp-api.ip.tv";
const ALLOWED_ORIGINS = new Set(["https://sed-gg.vercel.app"]);
const PREVIEW_ORIGIN = /^https:\/\/sed-[a-z0-9-]+\.vercel\.app$/i;

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type, X-Api-Key");
    res.setHeader("Access-Control-Max-Age", "600");
    res.setHeader("Vary", "Origin");
  }
  return { origin, allowed };
}

function fail(res, status, message) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ erro: message, upstream_status: status });
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function createSessionKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll("-", "");
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("") || String(Date.now());
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function cookieHeader(headers) {
  return setCookieValues(headers)
    .flatMap((value) => String(value).split(/,(?=[^;,=]+=)/))
    .map((value) => value.trim().split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function parseJson(text) {
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

function responseCookie(data, headers, fallback = "") {
  if (data && typeof data === "object") {
    const nested = data.data && typeof data.data === "object" ? data.data : {};
    const value = data.captchaCookie ?? data.captcha_cookie ?? nested.captchaCookie ?? nested.captcha_cookie;
    if (value) return String(value);
  }
  return cookieHeader(headers) || fallback;
}

function upstreamHeaders(sessionKey, captchaCookie = "", apiKey = "") {
  const headers = {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json",
    Origin: "https://saladofuturo.educacao.sp.gov.br",
    Referer: "https://saladofuturo.educacao.sp.gov.br/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "x-session-key": sessionKey,
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  if (captchaCookie) headers.Cookie = captchaCookie;
  return headers;
}

async function callUpstream(path, init) {
  try {
    return await fetch(`${EDUSP_BASE}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  const { origin, allowed } = applyCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    if (origin && !allowed) return res.status(403).end();
    return res.status(204).end();
  }
  if (origin && !allowed) return fail(res, 403, "Origem não autorizada.");
  if (req.method !== "POST") return fail(res, 405, "Método não permitido.");

  const apiKey = String(req.headers["x-api-key"] || "").trim();
  if (!apiKey || apiKey.length > 4096) return fail(res, 400, "Sessão EduSP ausente. Faça login novamente.");

  const body = readBody(req);
  const action = String(body?.action || "").trim().toLowerCase();
  if (action !== "challenge" && action !== "verify") return fail(res, 400, "Operação de CAPTCHA inválida.");

  const sessionKey = String(body?.sessionKey ?? body?.session_key ?? "").trim() || createSessionKey();
  const captchaCookie = String(body?.captchaCookie ?? body?.captcha_cookie ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{1,512}$/.test(sessionKey)) return fail(res, 400, "Sessão temporária do CAPTCHA inválida.");
  if (captchaCookie.length > 8192) return fail(res, 400, "Cookie temporário do CAPTCHA inválido.");

  let upstream;
  if (action === "challenge") {
    upstream = await callUpstream("/captcha/challenge", {
      method: "POST",
      headers: upstreamHeaders(sessionKey, "", apiKey),
      body: JSON.stringify({ type: "image" }),
    });
  } else {
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : body;
    const challengeId = String(payload?.challengeId ?? payload?.challenge_id ?? "").trim();
    const answer = String(payload?.answer ?? "").trim();
    if (!challengeId || challengeId.length > 512 || !answer || answer.length > 128) {
      return fail(res, 400, "Dados de validação do CAPTCHA inválidos.");
    }
    upstream = await callUpstream("/captcha/verify", {
      method: "POST",
      headers: upstreamHeaders(sessionKey, captchaCookie, apiKey),
      body: JSON.stringify({ challengeId, answer }),
    });
  }

  if (!upstream) return fail(res, 502, "Não foi possível conectar ao serviço de CAPTCHA. Gere um novo desafio.");

  const text = await upstream.text();
  const data = parseJson(text);
  if (!upstream.ok) {
    const upstreamMessage = data && typeof data === "object"
      ? String(data.erro || data.error || data.message || "")
      : "";
    return fail(res, upstream.status, upstreamMessage || `A plataforma recusou o CAPTCHA (HTTP ${upstream.status}).`);
  }

  const output = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : { data };
  output.sessionKey = sessionKey;
  output.captchaCookie = responseCookie(data, upstream.headers, captchaCookie);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  res.setHeader("X-Captcha-Proxy", "vercel-gru1");
  return res.status(upstream.status).send(JSON.stringify(output));
};

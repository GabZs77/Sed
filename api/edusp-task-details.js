// Proxy restrito para abrir o enunciado de uma atividade.
// O CAPTCHA e o apply da atividade são executados na mesma região gru1 da Vercel;
// isso preserva o contexto temporário caso o upstream associe o token à sessão/IP.
// A chave do aluno e o contexto temporário do CAPTCHA são usados apenas em memória.
const EDUSP_BASE = "https://edusp-api.ip.tv";
const ALLOWED_ORIGINS = new Set(["https://sed-gg.vercel.app"]);
const PREVIEW_ORIGIN = /^https:\/\/sed-[a-z0-9-]+\.vercel\.app$/i;

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept, X-Api-Key, X-Captcha-Token, X-Captcha-Session, X-Captcha-Cookie");
    res.setHeader("Access-Control-Max-Age", "600");
    res.setHeader("Vary", "Origin");
  }
  return { origin, allowed };
}

function fail(res, status, message) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ erro: message, upstream_status: status });
}

module.exports = async (req, res) => {
  const { origin, allowed } = applyCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    if (origin && !allowed) return res.status(403).end();
    return res.status(204).end();
  }
  if (origin && !allowed) return fail(res, 403, "Origem não autorizada.");
  if (req.method !== "GET") return fail(res, 405, "Método não permitido.");

  const apiKey = String(req.headers["x-api-key"] || "").trim();
  const captchaToken = String(req.headers["x-captcha-token"] || "").trim();
  const captchaSession = String(req.headers["x-captcha-session"] || "").trim();
  const captchaCookie = String(req.headers["x-captcha-cookie"] || "").trim();
  if (!apiKey || apiKey.length > 4096) return fail(res, 400, "Sessão EduSP ausente. Faça login novamente.");
  if (!captchaToken || captchaToken.length > 4096) return fail(res, 428, "CAPTCHA_REQUIRED: gere e valide um CAPTCHA novo.");
  if (captchaSession.length > 512 || captchaCookie.length > 8192) return fail(res, 400, "Sessão temporária do CAPTCHA inválida. Gere um novo desafio.");

  let incoming;
  try { incoming = new URL(req.url, "https://sed-gg.vercel.app"); }
  catch { return fail(res, 400, "Parâmetros da atividade inválidos."); }

  const taskId = String(incoming.searchParams.get("task_id") || "").trim();
  const roomName = String(incoming.searchParams.get("room_name") || "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(taskId)) return fail(res, 400, "Identificador da atividade inválido.");
  if (!roomName || roomName.length > 512 || /[\u0000-\u001f\u007f]/.test(roomName)) {
    return fail(res, 400, "Sala da atividade não identificada. Abra novamente a tarefa.");
  }

  // Um único apply por token: o CAPTCHA pode ser consumido mesmo quando o upstream
  // rejeita um parâmetro, portanto não repetimos a mesma credencial em tentativas cegas.
  const query = new URLSearchParams({
    preview_mode: "false",
    token_code: "null",
    room_name: roomName,
  });
  const upstreamUrl = `${EDUSP_BASE}/tms/task/${encodeURIComponent(taskId)}/apply?${query}`;
  const headers = {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json",
    Origin: "https://saladofuturo.educacao.sp.gov.br",
    Referer: "https://saladofuturo.educacao.sp.gov.br/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "x-api-platform": "webclient",
    "x-api-realm": "edusp",
    "x-api-key": apiKey,
    "x-captcha-token": captchaToken,
  };
  if (captchaSession) headers["x-session-key"] = captchaSession;
  if (captchaCookie) headers.Cookie = captchaCookie;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return fail(res, 502, "Não foi possível conectar ao serviço de atividades. Gere um CAPTCHA novo e tente novamente.");
  }

  const body = await upstream.text();
  if (!upstream.ok) {
    const message = upstream.status === 401
      ? "A plataforma recusou a sessão ou o CAPTCHA (HTTP 401). Faça login novamente e gere um desafio novo."
      : upstream.status === 404
        ? "A atividade não foi encontrada para esta sala (HTTP 404). Atualize a lista e tente novamente."
        : upstream.status === 429
          ? "Muitas tentativas de consulta. Aguarde um pouco e gere outro CAPTCHA."
          : `A plataforma não liberou a atividade (HTTP ${upstream.status}). Gere um CAPTCHA novo e tente novamente.`;
    return fail(res, upstream.status, message);
  }

  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Task-Proxy", "vercel-gru1");
  return res.status(upstream.status).send(body);
};

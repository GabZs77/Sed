const API_URL = "https://edusp-api.ip.tv/tms/task/todo";
const ALLOWED_ORIGIN = "https://sed-gg.vercel.app";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, X-Api-Key",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  const headers = new Headers(corsHeaders(origin));
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "GET" || url.pathname !== "/essays") {
      return json({ erro: "Rota não encontrada." }, 404, origin);
    }

    const apiKey = (request.headers.get("X-Api-Key") || "").trim();
    if (!apiKey || apiKey.length > 4096) {
      return json({ erro: "Faça login novamente para consultar as redações." }, 401, origin);
    }

    const limitValue = Number(url.searchParams.get("limit") || 100);
    const offsetValue = Number(url.searchParams.get("offset") || 0);
    const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 100;
    const offset = Number.isInteger(offsetValue) ? Math.max(offsetValue, 0) : 0;
    const upstream = new URL(API_URL);
    [
      ["expired_only", "false"],
      ["limit", String(limit)],
      ["offset", String(offset)],
      ["filter_expired", "true"],
      ["is_exam", "false"],
      ["with_answer", "true"],
      ["is_essay", "true"],
      ["answer_statuses", "draft"],
      ["answer_statuses", "pending"],
      ["with_apply_moment", "true"],
      ["exclude_category_id", "748331"],
    ].forEach(([key, value]) => upstream.searchParams.append(key, value));

    try {
      const response = await fetch(upstream.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "X-Api-Key": apiKey,
          Origin: "https://saladofuturo.educacao.sp.gov.br",
          Referer: "https://saladofuturo.educacao.sp.gov.br/",
        },
      });
      const body = await response.arrayBuffer();
      const headers = new Headers(corsHeaders(origin));
      headers.set("Content-Type", response.headers.get("Content-Type") || "application/json; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return new Response(body, { status: response.status, headers });
    } catch (_) {
      return json({ erro: "Não foi possível consultar as redações agora. Tente novamente." }, 502, origin);
    }
  },
};

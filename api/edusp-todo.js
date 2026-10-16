// Proxy da lista de tarefas do Sala do Futuro (edusp-api.ip.tv/tms/task/todo).
// Existe porque o ip.tv bloqueia pedidos de tarefas vindos de Cloudflare Workers.
// Roda na Vercel em São Paulo (gru1). Só repassa este endpoint, com a chave do próprio aluno.
const ALLOWED = new Set(["expired_only","limit","offset","filter_expired","is_exam","with_answer","is_essay","answer_statuses","with_apply_moment","publication_target"]);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-api-key, content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ erro: "Método não permitido" });
  const key = String(req.headers["x-api-key"] || "");
  if (!key || key.length > 4096) return res.status(400).json({ erro: "x-api-key ausente" });

  const incoming = new URL(req.url, "http://x");
  const params = new URLSearchParams();
  for (const [k, v] of incoming.searchParams) if (ALLOWED.has(k)) params.append(k, v.slice(0, 200));

  const upstream = await fetch(`https://edusp-api.ip.tv/tms/task/todo?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Origin: "https://saladofuturo.educacao.sp.gov.br",
      Referer: "https://saladofuturo.educacao.sp.gov.br/",
      "content-type": "application/json",
      "x-api-platform": "webclient",
      "x-api-realm": "edusp",
      "x-api-key": key,
    },
  });
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.setHeader("Cache-Control", "no-store");
  return res.send(text);
};

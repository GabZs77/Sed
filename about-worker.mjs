const SITE_ORIGIN = "https://sed-gg.vercel.app";
const SED_BASE = "https://sedintegracoes.educacao.sp.gov.br";
const ABOUT_KEYS = {
  draft: "about:draft",
  published: "about:published",
  versionPrefix: "about:version:",
};
const MAX_DOCUMENT_BYTES = 1_200_000;
const MAX_IMAGE_CHARS = 700_000;
const MAX_SECTIONS = 30;

export function defaultAboutDocument() {
  return {
    title: "Sobre o SEDX",
    intro: "Uma experiência criada para deixar a rotina escolar mais clara, organizada e fácil de acompanhar.",
    sections: [
      {
        id: "diferenciais",
        title: "O que torna o SEDX diferente?",
        text: "Ferramentas escolares importantes se encontram em uma experiência simples, responsiva e pensada para o dia a dia do estudante.",
        icon: "✦",
        image: "",
        links: [],
        buttons: [],
      },
      {
        id: "praticidade",
        title: "Praticidade",
        text: "Consulte agenda, tarefas, presença, boletim e apostilas sem precisar percorrer várias telas diferentes.",
        icon: "◉",
        image: "",
        links: [],
        buttons: [],
      },
      {
        id: "organizacao",
        title: "Organização",
        text: "Veja tarefas e prazos com mais clareza e acompanhe os compromissos da rotina escolar em um só lugar.",
        icon: "▦",
        image: "",
        links: [],
        buttons: [],
      },
      {
        id: "acessibilidade",
        title: "Acessibilidade",
        text: "Interface adaptável para celular e computador, com navegação direta e atenção à legibilidade.",
        icon: "◎",
        image: "",
        links: [],
        buttons: [],
      },
      {
        id: "integradas",
        title: "Ferramentas integradas",
        text: "Recursos de apoio ao estudo, como assistência por IA, complementam as ferramentas escolares.",
        icon: "⌘",
        image: "",
        links: [],
        buttons: [],
      },
    ],
  };
}

function normalizeId(value, fallback) {
  const id = String(value || fallback).trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : fallback;
}

function normalizeLinkList(value, label) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => {
    const text = String(item?.label || "").trim().slice(0, 60);
    const href = String(item?.url || "").trim().slice(0, 2048);
    if (!text || !isHttpUrl(href)) return null;
    return { label: text, url: href, type: label };
  }).filter(Boolean);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeAboutDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("O conteúdo da página Sobre é inválido.");
  }
  const sections = Array.isArray(value.sections) ? value.sections : [];
  if (sections.length > MAX_SECTIONS) throw new Error(`A página pode ter no máximo ${MAX_SECTIONS} seções.`);
  const normalized = {
    title: String(value.title || "Sobre o SEDX").trim().slice(0, 120),
    intro: String(value.intro || "").trim().slice(0, 1_000),
    sections: sections.map((section, index) => {
      const image = String(section?.image || "");
      if (image && (!/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE_CHARS)) {
        throw new Error("Uma imagem está em formato inválido ou excede o limite permitido.");
      }
      return {
        id: normalizeId(section?.id, `section-${index + 1}`),
        title: String(section?.title || "").trim().slice(0, 120),
        text: String(section?.text || "").trim().slice(0, 3_000),
        icon: String(section?.icon || "").trim().slice(0, 32),
        image,
        links: normalizeLinkList(section?.links, "link"),
        buttons: normalizeLinkList(section?.buttons, "button"),
      };
    }),
  };
  if (!normalized.title) throw new Error("Informe um título para a página.");
  const bytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
  if (bytes > MAX_DOCUMENT_BYTES) throw new Error("O conteúdo está muito grande. Reduza o tamanho das imagens e tente novamente.");
  return normalized;
}

function responseHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = origin === SITE_ORIGIN ? origin : SITE_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-Token, X-Token2, X-Cd-Usuario, X-Usuario, X-Admin-User",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function jsonResponse(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...responseHeaders(request) },
  });
}

function cleanId(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 24);
}

function identityValues(data) {
  const matches = [];
  const visited = new Set();
  const identityKeys = new Set([
    "ra", "numerora", "cdusuario", "cdusuariocurto", "cdusuariocompleto",
    "codigoaluno", "codigousuario", "cdaluno", "identificadoraluno",
    "raaluno", "radigito", "raestudante", "numeroraaluno", "codigoalunora",
  ]);
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 8 || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, depth + 1));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (identityKeys.has(normalizedKey) && (typeof value === "string" || typeof value === "number")) {
        const digits = cleanId(value);
        if (digits) matches.push(digits);
      }
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  walk(data);
  return matches;
}

async function verifyAdmin(request, env, subscriptionKey) {
  const claimed = cleanId(request.headers.get("X-Admin-User") || request.headers.get("X-Usuario"));
  const sessionRa = cleanId(request.headers.get("X-Usuario"));
  const shortCode = cleanId(request.headers.get("X-Cd-Usuario"));
  const token = String(request.headers.get("X-Token") || "").trim();
  const token2 = String(request.headers.get("X-Token2") || "").trim();
  if (!claimed || claimed !== sessionRa || !token || !token2) return { authorized: false };
  if (!env?.SEDX_ADMIN) return { authorized: false, unavailable: true };

  const admin = await env.SEDX_ADMIN.prepare(
    "SELECT ra FROM admin_users WHERE ra = ? AND role = 'Administrador' AND status = 'Ativo' LIMIT 1",
  ).bind(sessionRa).first();
  if (!admin) return { authorized: false };

  const codeToCheck = shortCode || sessionRa;
  const query = `api/Aluno/ObterAlunoPorCodigo?codigoAluno=${encodeURIComponent(codeToCheck)}`;
  const candidates = [
    `${SED_BASE}/${query}`,
    `${SED_BASE}/saladofuturobffapi/${query}`,
  ];
  let profile = null;
  let profileLoaded = false;
  let upstreamUnavailable = false;
  for (const endpoint of candidates) {
    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": subscriptionKey,
          "x-product-name": "SalaDoFuturo",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
    } catch {
      upstreamUnavailable = true;
      continue;
    }
    if (!upstream.ok) {
      if (upstream.status >= 500) upstreamUnavailable = true;
      continue;
    }
    try { profile = await upstream.json(); profileLoaded = true; break; }
    catch { continue; }
  }
  if (!profileLoaded) return { authorized: false, unavailable: upstreamUnavailable };
  const actualIds = identityValues(profile);
  const acceptedIds = new Set([sessionRa]);
  // A tela de aluno usa o código curto sem o último dígito verificador.
  if (shortCode && sessionRa.length === shortCode.length + 1 && sessionRa.startsWith(shortCode)) {
    acceptedIds.add(shortCode);
  }
  return { authorized: actualIds.some((id) => acceptedIds.has(id)), actor: sessionRa };
}

function parseSetting(row) {
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

async function readSetting(db, key) {
  const row = await db.prepare("SELECT value FROM site_settings WHERE key = ? LIMIT 1").bind(key).first();
  return parseSetting(row);
}

async function writeSetting(db, key, value) {
  await db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

async function audit(db, actor, action, detail = "") {
  await db.prepare(
    "INSERT INTO audit_logs (actor_ra, action, detail, created_at) VALUES (?, ?, ?, ?)",
  ).bind(actor, action, detail.slice(0, 500), new Date().toISOString()).run();
}

function versionId() {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

async function bodyJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_DOCUMENT_BYTES + 16_384) throw new Error("O conteúdo enviado excede o limite permitido.");
  return request.json();
}

async function listVersions(db) {
  const result = await db.prepare(
    "SELECT key, value FROM site_settings WHERE key LIKE ? ORDER BY key DESC LIMIT 50",
  ).bind(`${ABOUT_KEYS.versionPrefix}%`).all();
  return (result.results || []).map((row) => {
    const snapshot = parseSetting(row);
    if (!snapshot) return null;
    return {
      id: snapshot.id,
      publishedAt: snapshot.publishedAt,
      title: snapshot.content?.title || "Sobre o SEDX",
    };
  }).filter((item) => item?.id);
}

export async function handleAboutRequest(request, env, url, subscriptionKey) {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const isAboutPath = path === "/about" || path === "/admin/about" || path.startsWith("/admin/about/");
  if (!isAboutPath) return null;
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(request) });
  const db = env?.SEDX_ADMIN;
  if (!db) return jsonResponse(request, { erro: "Armazenamento da página Sobre indisponível." }, 503);

  if (path === "/about" && method === "GET") {
    const published = await readSetting(db, ABOUT_KEYS.published);
    if (!published?.content) return jsonResponse(request, { ok: true, published: false, content: null });
    return jsonResponse(request, { ok: true, published: true, ...published });
  }

  const authorization = await verifyAdmin(request, env, subscriptionKey);
  if (!authorization.authorized) {
    return jsonResponse(request, {
      erro: authorization.unavailable ? "Não foi possível validar sua sessão administrativa agora." : "Acesso administrativo não autorizado.",
    }, authorization.unavailable ? 503 : 403);
  }

  if (path === "/admin/about" && method === "GET") {
    const [draft, published, versions] = await Promise.all([
      readSetting(db, ABOUT_KEYS.draft),
      readSetting(db, ABOUT_KEYS.published),
      listVersions(db),
    ]);
    return jsonResponse(request, {
      ok: true,
      isAdmin: true,
      draft: draft || defaultAboutDocument(),
      published,
      versions,
    });
  }

  if (path === "/admin/about/draft" && method === "PUT") {
    let document;
    try { document = normalizeAboutDocument(await bodyJson(request)); }
    catch (error) { return jsonResponse(request, { erro: error.message || "Rascunho inválido." }, 400); }
    await writeSetting(db, ABOUT_KEYS.draft, document);
    await audit(db, authorization.actor, "Rascunho Sobre salvo", document.title);
    return jsonResponse(request, { ok: true, draft: document });
  }

  if (path === "/admin/about/publish" && method === "POST") {
    const draft = await readSetting(db, ABOUT_KEYS.draft);
    if (!draft) return jsonResponse(request, { erro: "Salve um rascunho antes de publicar." }, 400);
    let document;
    try { document = normalizeAboutDocument(draft); }
    catch (error) { return jsonResponse(request, { erro: error.message || "Rascunho inválido." }, 400); }
    const id = versionId();
    const publishedAt = new Date().toISOString();
    const snapshot = { id, publishedAt, content: document };
    await writeSetting(db, `${ABOUT_KEYS.versionPrefix}${id}`, snapshot);
    await writeSetting(db, ABOUT_KEYS.published, snapshot);
    await audit(db, authorization.actor, "Página Sobre publicada", `${document.title} (${id})`);
    return jsonResponse(request, { ok: true, published: snapshot, versions: await listVersions(db) });
  }

  if (path === "/admin/about/unpublish" && method === "POST") {
    await db.prepare("DELETE FROM site_settings WHERE key = ?").bind(ABOUT_KEYS.published).run();
    await audit(db, authorization.actor, "Página Sobre despublicada");
    return jsonResponse(request, { ok: true, published: false });
  }

  if (path === "/admin/about/restore" && method === "POST") {
    let payload;
    try { payload = await bodyJson(request); }
    catch { return jsonResponse(request, { erro: "Não foi possível ler a versão escolhida." }, 400); }
    const id = String(payload?.versionId || "");
    if (!/^\d{13}-[a-f0-9]{8}$/.test(id)) return jsonResponse(request, { erro: "Versão inválida." }, 400);
    const snapshot = await readSetting(db, `${ABOUT_KEYS.versionPrefix}${id}`);
    if (!snapshot?.content) return jsonResponse(request, { erro: "Essa versão não foi encontrada." }, 404);
    const document = normalizeAboutDocument(snapshot.content);
    await writeSetting(db, ABOUT_KEYS.draft, document);
    await audit(db, authorization.actor, "Versão da página Sobre restaurada para rascunho", id);
    return jsonResponse(request, { ok: true, draft: document, restoredFrom: id });
  }

  return jsonResponse(request, { erro: "Rota ou método não encontrado." }, 404);
}

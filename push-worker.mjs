const PUSH_ORIGIN = "https://sed-gg.vercel.app";
const EDUSP_BASE = "https://edusp-api.ip.tv";
const SED_BASE = "https://sedintegracoes.educacao.sp.gov.br";
const UPSTREAM_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://saladofuturo.educacao.sp.gov.br",
  Referer: "https://saladofuturo.educacao.sp.gov.br/",
};
const utf8 = new TextEncoder();

function headers(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": origin === PUSH_ORIGIN ? origin : PUSH_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-Token,X-Token2,X-Cd-Usuario,X-Task-User,X-Usuario",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}
function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers(request), "Content-Type": "application/json; charset=utf-8" } });
}
function b64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  const text = atob(padded);
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function cleanRa(value) { return String(value || "").replace(/\D/g, "").slice(0, 24); }
function parseJson(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}
async function hkdfExpand(prk, info, length) {
  const output = [];
  let previous = new Uint8Array();
  for (let counter = 1; output.reduce((n, part) => n + part.length, 0) < length; counter += 1) {
    previous = await hmac(prk, concat(previous, info, new Uint8Array([counter])));
    output.push(previous);
  }
  return concat(...output).slice(0, length);
}

export async function encryptPushPayload(subscription, payload) {
  const p256dh = fromB64url(subscription?.keys?.p256dh || "");
  const auth = fromB64url(subscription?.keys?.auth || "");
  if (p256dh.length !== 65 || auth.length < 16) throw new Error("Chaves da assinatura push inválidas.");
  const userPublic = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userPublic }, ephemeral.privateKey, 256));
  const authPrk = await hmac(auth, sharedSecret);
  const keyInfo = concat(utf8.encode("WebPush: info\0"), p256dh, serverPublic);
  const inputKeyMaterial = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, inputKeyMaterial);
  const contentKey = await hkdfExpand(prk, utf8.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, utf8.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", contentKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = concat(utf8.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext));
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, recordSize, new Uint8Array([serverPublic.length]), serverPublic, ciphertext);
}

async function vapidAuthorization(endpoint, env) {
  const publicKey = String(env.PUSH_VAPID_PUBLIC_KEY || "");
  const privateJwk = parseJson(env.PUSH_VAPID_PRIVATE_JWK);
  if (!publicKey || !privateJwk?.d) throw new Error("Chaves VAPID ainda não configuradas.");
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(utf8.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))}.${b64url(utf8.encode(JSON.stringify({ aud: audience, exp: now + 12 * 60 * 60, sub: "mailto:suporte@sedx.app" })))}`;
  const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, utf8.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${publicKey}`;
}

async function sendOnePush(env, subscription, payload) {
  const body = await encryptPushPayload(subscription, payload);
  const authorization = await vapidAuthorization(subscription.endpoint, env);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      TTL: "86400",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Urgency: "high",
    },
    body,
  });
  return response;
}

async function subscriptionsFor(db, ra = "") {
  const statement = ra
    ? db.prepare("SELECT endpoint, user_ra, subscription_json FROM push_subscriptions WHERE user_ra = ?").bind(ra)
    : db.prepare("SELECT endpoint, user_ra, subscription_json FROM push_subscriptions");
  const result = await statement.all();
  return (result.results || []).map((row) => ({ endpoint: row.endpoint, userRa: row.user_ra, subscription: parseJson(row.subscription_json) })).filter((row) => row.subscription?.keys?.p256dh && row.subscription?.keys?.auth);
}

async function removeUserIfNoSubscriptions(db, ra) {
  const remaining = await db.prepare("SELECT endpoint FROM push_subscriptions WHERE user_ra = ? LIMIT 1").bind(ra).first();
  if (!remaining) {
    await db.prepare("DELETE FROM push_users WHERE user_ra = ?").bind(ra).run();
    await db.prepare("DELETE FROM push_daily_log WHERE user_ra = ?").bind(ra).run();
  }
}

export async function sendPushToAll(env, payload) {
  const db = env?.SEDX_ADMIN;
  if (!db) return { sent: 0, failed: 0 };
  const all = await subscriptionsFor(db);
  let sent = 0; let failed = 0;
  for (let offset = 0; offset < all.length; offset += 20) {
    const results = await Promise.all(all.slice(offset, offset + 20).map(async (item) => {
      try {
        const response = await sendOnePush(env, item.subscription, payload);
        if (response.status === 404 || response.status === 410) {
          await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(item.endpoint).run();
          if (item.userRa) await removeUserIfNoSubscriptions(db, item.userRa);
        }
        await response.body?.cancel?.();
        return response.ok ? "sent" : "failed";
      } catch (error) {
        console.warn("[SEDX Push] falha ao enviar", String(error?.message || error).slice(0, 140));
        return "failed";
      }
    }));
    sent += results.filter((result) => result === "sent").length;
    failed += results.filter((result) => result === "failed").length;
  }
  return { sent, failed };
}

async function encryptionKey(env) {
  const hex = String(env.PUSH_SESSION_ENCRYPTION_KEY || env.PUSH_ENCRYPTION_KEY || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("Chave de criptografia do push ausente.");
  const bytes = Uint8Array.from(hex.match(/.{2}/g), (part) => parseInt(part, 16));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptSession(env, session) {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8.encode(JSON.stringify(session)));
  return { iv: b64url(iv), ciphertext: b64url(new Uint8Array(ciphertext)) };
}
async function decryptSession(env, row) {
  const key = await encryptionKey(env);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(row.session_iv) }, key, fromB64url(row.session_ciphertext));
  return parseJson(new TextDecoder().decode(plaintext), {});
}

async function readRequestJson(request, limit = 120_000) {
  const text = await request.text();
  if (text.length > limit) throw new Error("Solicitação acima do limite permitido.");
  return JSON.parse(text || "{}");
}

export async function handlePushRequest(request, env, url) {
  const path = url.pathname;
  if (!path.startsWith("/push/")) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(request) });
  if (!env?.SEDX_ADMIN) return json(request, { erro: "Armazenamento de notificações indisponível." }, 503);
  if (path === "/push/config" && request.method === "GET") {
    if (!env.PUSH_VAPID_PUBLIC_KEY) return json(request, { erro: "Push ainda não está configurado." }, 503);
    return json(request, { ok: true, publicKey: env.PUSH_VAPID_PUBLIC_KEY });
  }

  const ra = cleanRa(request.headers.get("X-Usuario"));
  const token2 = String(request.headers.get("X-Token2") || "").trim();
  if (!ra || !token2) return json(request, { erro: "Faça login para ativar as notificações." }, 401);

  if (path === "/push/subscribe" && request.method === "POST") {
    let body;
    try { body = await readRequestJson(request); } catch (error) { return json(request, { erro: error.message || "Solicitação inválida." }, 400); }
    const subscription = body.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return json(request, { erro: "Assinatura do navegador inválida." }, 400);
    let endpoint;
    try { endpoint = new URL(subscription.endpoint); } catch { return json(request, { erro: "Endereço de push inválido." }, 400); }
    const allowedPushHost = endpoint.hostname === "fcm.googleapis.com" || endpoint.hostname.endsWith(".push.services.mozilla.com") || endpoint.hostname === "push.services.mozilla.com" || endpoint.hostname === "web.push.apple.com" || endpoint.hostname.endsWith(".push.apple.com") || endpoint.hostname.endsWith(".notify.windows.com");
    if (endpoint.protocol !== "https:" || !allowedPushHost) return json(request, { erro: "O navegador retornou um serviço push não reconhecido." }, 400);
    const token = String(request.headers.get("X-Token") || "").trim();
    const cdUsuario = String(request.headers.get("X-Cd-Usuario") || "").trim();
    if (!token || !cdUsuario) return json(request, { erro: "Sessão incompleta. Entre novamente no SEDX." }, 401);
    try {
      const encrypted = await encryptSession(env, { token, token2, cdUsuario, username: String(request.headers.get("X-Task-User") || "") });
      const timestamp = new Date().toISOString();
      await env.SEDX_ADMIN.prepare(
        "INSERT INTO push_users (user_ra, session_ciphertext, session_iv, task_ids_json, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?) ON CONFLICT(user_ra) DO UPDATE SET session_ciphertext = excluded.session_ciphertext, session_iv = excluded.session_iv, updated_at = excluded.updated_at",
      ).bind(ra, encrypted.ciphertext, encrypted.iv, timestamp, timestamp).run();
      await env.SEDX_ADMIN.prepare(
        "INSERT INTO push_subscriptions (endpoint, user_ra, subscription_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_ra = excluded.user_ra, subscription_json = excluded.subscription_json",
      ).bind(endpoint.toString(), ra, JSON.stringify(subscription), timestamp).run();
      return json(request, { ok: true, message: "Notificações ativadas neste dispositivo." }, 201);
    } catch (error) {
      console.error("[SEDX Push] não foi possível registrar a assinatura", String(error?.message || error).slice(0, 120));
      return json(request, { erro: "Não foi possível ativar as notificações. Tente novamente." }, 503);
    }
  }

  if (path === "/push/unsubscribe" && request.method === "POST") {
    let body;
    try { body = await readRequestJson(request, 10_000); } catch { return json(request, { erro: "Solicitação inválida." }, 400); }
    const endpoint = String(body.endpoint || "");
    if (!endpoint) return json(request, { erro: "Assinatura não informada." }, 400);
    await env.SEDX_ADMIN.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_ra = ?").bind(endpoint, ra).run();
    await removeUserIfNoSubscriptions(env.SEDX_ADMIN, ra);
    return json(request, { ok: true });
  }
  return json(request, { erro: "Rota push não encontrada." }, 404);
}

function brazilDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function brazilWeekday(date = new Date()) {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(date);
  return !["Sat", "Sun"].includes(value);
}
function brazilMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  return part("hour") * 60 + part("minute");
}
function taskId(task) {
  const id = task?.id ?? task?.task_id ?? task?.taskId;
  if (id !== undefined && id !== null && String(id)) return String(id);
  return `${String(task?.title || task?.name || task?.titulo || "Tarefa")}|${String(task?.apply_moment || task?.applyMoment || task?.due_date || task?.dueDate || "")}`;
}
function taskTitle(task) { return String(task?.title || task?.name || task?.titulo || "Nova tarefa").slice(0, 120); }
function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["tasks", "items", "data", "results", "todo"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}
async function fetchTaskList(token2, username) {
  const targets = [];
  try {
    const roomsResponse = await fetch(`${EDUSP_BASE}/room/user?list_all=true&with_cards=true`, {
      headers: { ...UPSTREAM_HEADERS, "x-api-platform": "webclient", "x-api-realm": "edusp", "x-api-key": token2 },
    });
    if (roomsResponse.ok) {
      const roomPayload = await roomsResponse.json();
      for (const room of (Array.isArray(roomPayload?.rooms) ? roomPayload.rooms : [])) {
        if (room?.name) targets.push(String(room.name));
        for (const category of (Array.isArray(room?.group_categories) ? room.group_categories : [])) if (category?.id !== undefined) targets.push(String(category.id));
      }
    }
  } catch {}
  const rawTargets = [...new Set([...targets, "1052", "1820", "764"])];
  const base = new URLSearchParams({ expired_only: "false", limit: "100", offset: "0", filter_expired: "true", is_exam: "false", with_answer: "true", is_essay: "false", with_apply_moment: "true" });
  base.append("answer_statuses", "draft"); base.append("answer_statuses", "pending");
  const fetchFor = async (destinations) => {
    const params = new URLSearchParams(base);
    for (const dest of destinations) params.append("publication_target", dest);
    return fetch(`${EDUSP_BASE}/tms/task/todo?${params.toString()}`, {
      headers: { ...UPSTREAM_HEADERS, "x-api-platform": "webclient", "x-api-realm": "edusp", "x-api-key": token2 },
    });
  };
  try {
    let response = await fetchFor(rawTargets);
    if (response.ok) {
      let tasks = listFrom(await response.json());
      if (tasks.length) return tasks;
    }
    const gathered = [];
    for (const target of rawTargets) {
      try { response = await fetchFor([target]); if (response.ok) gathered.push(...listFrom(await response.json())); } catch {}
    }
    if (gathered.length) return gathered;
    response = await fetchFor([]);
    return response.ok ? listFrom(await response.json()) : null;
  } catch { return null; }
}
async function sedGet(path, token, subscriptionKey) {
  const clean = String(path).replace(/^\/+/, "");
  const paths = [clean.replace(/^saladofuturobffapi\//, ""), `saladofuturobffapi/${clean.replace(/^saladofuturobffapi\//, "")}`];
  for (const candidate of paths) {
    for (const bearer of token ? [true, false] : [false]) {
      try {
        const response = await fetch(`${SED_BASE}/${candidate}`, { headers: {
          Accept: "application/json", "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": subscriptionKey,
          "x-product-name": "SalaDoFuturo", ...(bearer ? { Authorization: `Bearer ${token}` } : {}),
        } });
        if (!response.ok) continue;
        return await response.json();
      } catch {}
    }
  }
  return null;
}
async function fetchFirstClass(session, subscriptionKey, date) {
  const payload = await sedGet(`apiboletim/api/Agenda/GetAgendaDia?codigoAluno=${encodeURIComponent(session.cdUsuario)}&anoLetivo=${date.slice(0, 4)}&dataAgenda=${date}`, session.token, subscriptionKey);
  const rows = Array.isArray(payload?.data?.agendaAluno) ? payload.data.agendaAluno : [];
  const lessons = rows.map((row) => ({
    title: String(row?.nomeDisciplina || "Aula"),
    start: String(row?.horaInicioAula || "").slice(0, 5),
    end: String(row?.horaFimAula || "").slice(0, 5),
  })).filter((row) => /^\d{2}:\d{2}$/.test(row.start) && !/intervalo|almo/i.test(row.title));
  lessons.sort((a, b) => a.start.localeCompare(b.start));
  return lessons[0] || null;
}

async function withUserSubscriptions(db, ra) {
  return subscriptionsFor(db, ra);
}
async function pushToUser(env, ra, payload) {
  const list = await withUserSubscriptions(env.SEDX_ADMIN, ra);
  let success = false;
    for (const item of list) {
    try {
      const response = await sendOnePush(env, item.subscription, payload);
      if (response.status === 404 || response.status === 410) {
        await env.SEDX_ADMIN.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(item.endpoint).run();
        await removeUserIfNoSubscriptions(env.SEDX_ADMIN, ra);
      }
      else if (response.ok) success = true;
      await response.body?.cancel?.();
    } catch (error) { console.warn("[SEDX Push] falha em uma assinatura", String(error?.message || error).slice(0, 100)); }
  }
  return success;
}

export async function sendNoticePush(env, notice) {
  const db = env?.SEDX_ADMIN;
  const id = String(notice?.id || "").trim().slice(0, 160);
  if (!db || !id || !env.PUSH_VAPID_PUBLIC_KEY || !env.PUSH_VAPID_PRIVATE_JWK) return { sent: 0, failed: 0 };
  const recipients = await db.prepare(
    "SELECT DISTINCT u.user_ra FROM push_users u JOIN push_subscriptions s ON s.user_ra = u.user_ra LEFT JOIN push_notice_deliveries d ON d.user_ra = u.user_ra AND d.notice_id = ? WHERE d.user_ra IS NULL",
  ).bind(id).all();
  const title = String(notice?.title || "Nova publicação do SEDX").trim().slice(0, 120) || "Nova publicação do SEDX";
  const body = String(notice?.description || "Uma nova publicação está disponível no SEDX.").trim().slice(0, 240);
  const payload = { title, body, url: "/", tag: `admin-notice-${id}`, kind: "admin-notice" };
  let sent = 0;
  let failed = 0;
  for (const row of recipients.results || []) {
    const ra = cleanRa(row.user_ra);
    if (!ra) continue;
    try {
      if (await pushToUser(env, ra, payload)) {
        await db.prepare("INSERT OR IGNORE INTO push_notice_deliveries (user_ra, notice_id, sent_at) VALUES (?, ?, ?)").bind(ra, id, new Date().toISOString()).run();
        sent += 1;
      } else failed += 1;
    } catch (error) {
      failed += 1;
      console.warn("[SEDX Push] falha ao notificar uma publicação", String(error?.message || error).slice(0, 100));
    }
  }
  return { sent, failed };
}

export async function runPushSchedule(env, subscriptionKey) {
  const db = env?.SEDX_ADMIN;
  if (!db || !env.PUSH_VAPID_PUBLIC_KEY || !env.PUSH_VAPID_PRIVATE_JWK || !(env.PUSH_SESSION_ENCRYPTION_KEY || env.PUSH_ENCRYPTION_KEY)) return;
  const usersResult = await db.prepare("SELECT user_ra, session_ciphertext, session_iv, task_ids_json FROM push_users WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_ra = push_users.user_ra)").all();
  const users = usersResult.results || [];
  const now = new Date();
  const date = brazilDate(now);
  const weekday = brazilWeekday(now);
  const minuteNow = brazilMinutes(now);

  for (const row of users) {
    const ra = cleanRa(row.user_ra);
    if (!ra) continue;
    try {
      const session = await decryptSession(env, row);
      if (!session.token2) continue;
      const tasks = await fetchTaskList(session.token2, session.username || "");
      if (Array.isArray(tasks)) {
        const current = [...new Set(tasks.map(taskId))];
        const previous = parseJson(row.task_ids_json, null);
        if (!Array.isArray(previous)) {
          await db.prepare("UPDATE push_users SET task_ids_json = ?, updated_at = ? WHERE user_ra = ?").bind(JSON.stringify(current), now.toISOString(), ra).run();
        } else {
          const known = new Set(previous);
          const fresh = [...new Map(tasks.filter((task) => !known.has(taskId(task))).map((task) => [taskId(task), task])).values()];
          if (fresh.length) {
            for (const task of fresh.slice(0, 5)) {
              await pushToUser(env, ra, { title: "Nova tarefa", body: taskTitle(task), url: "/tarefas", tag: `task-${taskId(task)}`, kind: "new-task" });
            }
          }
          await db.prepare("UPDATE push_users SET task_ids_json = ?, updated_at = ? WHERE user_ra = ?").bind(JSON.stringify(current), now.toISOString(), ra).run();
        }
      }
      if (!weekday || !session.token || !session.cdUsuario) continue;
      const lesson = await fetchFirstClass(session, subscriptionKey, date);
      if (!lesson) continue;
      const [hour, minute] = lesson.start.split(":").map(Number);
      const startMinute = hour * 60 + minute;
      const reminderMinute = startMinute - 30;
      if (minuteNow < reminderMinute || minuteNow >= reminderMinute + 10) continue;
      const sent = await db.prepare("SELECT user_ra FROM push_daily_log WHERE user_ra = ? AND local_date = ? AND kind = 'lesson'").bind(ra, date).first();
      if (sent) continue;
      const ok = await pushToUser(env, ra, {
        title: "Sua aula começa em 30 minutos",
        body: `${lesson.title} às ${lesson.start}. Sua presença é muito importante!`,
        url: "/agenda",
        tag: `lesson-${date}`,
        kind: "lesson-reminder",
      });
      if (ok) await db.prepare("INSERT OR IGNORE INTO push_daily_log (user_ra, local_date, kind, sent_at) VALUES (?, ?, 'lesson', ?)").bind(ra, date, now.toISOString()).run();
    } catch (error) {
      console.warn("[SEDX Push] rotina agendada falhou para uma conta", String(error?.message || error).slice(0, 120));
    }
  }
}

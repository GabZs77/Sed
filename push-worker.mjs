const encoder = new TextEncoder();
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const TASK_POLL_MS = 5 * 60 * 1000;
const MAX_USERS_PER_TICK = 5;
const MAX_SEEN_TASKS = 500;

function asBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function concatBytes(...chunks) {
  const arrays = chunks.map(asBytes);
  const output = new Uint8Array(arrays.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of arrays) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function base64UrlEncode(value) {
  const bytes = asBytes(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function utf8(value) {
  return encoder.encode(String(value));
}

function validTimeZone(value) {
  try {
    const zone = String(value || '').trim();
    if (!zone) return DEFAULT_TIME_ZONE;
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    weekday: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date),
  };
}

export function selectFirstClass(events, localDate) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      const date = String(event?.data || event?.date || '').slice(0, 10);
      const time = String(event?.horaInicio || event?.startTime || '').slice(0, 5);
      return date === localDate && event?.tipo === 'aula' && /^\d{2}:\d{2}$/.test(time);
    })
    .sort((left, right) => String(left.horaInicio).localeCompare(String(right.horaInicio)))[0] || null;
}

export function isClassReminderDue(classTime, now, timeZone = DEFAULT_TIME_ZONE) {
  const value = String(classTime || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) return false;
  const current = localParts(now instanceof Date ? now : new Date(now), validTimeZone(timeZone));
  if (current.weekday === 'Sat' || current.weekday === 'Sun') return false;
  const classMinutes = hour * 60 + minute;
  return current.minutes >= classMinutes - 60 && current.minutes < classMinutes;
}

function jsonResponse(deps, data, status = 200) {
  if (typeof deps?.jsonResponse === 'function') return deps.jsonResponse(data, status);
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function readVapidPrivateKey(env) {
  try {
    const source = env?.PUSH_VAPID_PRIVATE_JWK;
    const jwk = typeof source === 'string' ? JSON.parse(source) : source;
    if (jwk?.kty !== 'EC' || jwk?.crv !== 'P-256' || !jwk?.x || !jwk?.y || !jwk?.d) return null;
    return jwk;
  } catch {
    return null;
  }
}

export function getVapidPublicKey(env) {
  const jwk = readVapidPrivateKey(env);
  if (!jwk) return null;
  return base64UrlEncode(concatBytes(Uint8Array.of(4), base64UrlDecode(jwk.x), base64UrlDecode(jwk.y)));
}

async function importSessionKey(env, usage) {
  const raw = base64UrlDecode(env?.PUSH_SESSION_ENCRYPTION_KEY || '');
  if (raw.length !== 32) throw new Error('Push session encryption is not configured.');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);
}

async function encryptSession(session, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importSessionKey(env, 'encrypt');
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(session)));
  return { ciphertext: base64UrlEncode(new Uint8Array(encrypted)), iv: base64UrlEncode(iv) };
}

async function decryptSession(row, env) {
  const key = await importSessionKey(env, 'decrypt');
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(row.session_iv) },
    key,
    base64UrlDecode(row.session_ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}

function normalizeUserRa(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

function normalizeTaskId(task) {
  const value = task?.id ?? task?.task_id ?? task?.taskId ?? task?.uuid;
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeTaskTitle(task) {
  return String(task?.title || task?.titulo || task?.name || task?.nome || 'Nova tarefa').trim().slice(0, 110);
}

function validPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const trustedHost = host === 'fcm.googleapis.com'
      || host === 'push.services.mozilla.com'
      || host.endsWith('.push.services.mozilla.com')
      || host === 'web.push.apple.com'
      || host.endsWith('.push.apple.com')
      || host.endsWith('.notify.windows.com');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && trustedHost;
  } catch {
    return false;
  }
}

function validSubscription(subscription) {
  return Boolean(
    subscription
      && typeof subscription.endpoint === 'string'
      && validPushEndpoint(subscription.endpoint)
      && typeof subscription.keys?.p256dh === 'string'
      && typeof subscription.keys?.auth === 'string',
  );
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', asBytes(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, asBytes(data)));
}

async function hkdfExpand(prk, info, length) {
  const output = [];
  let previous = new Uint8Array(0);
  let size = 0;
  for (let counter = 1; size < length; counter += 1) {
    previous = await hmacSha256(prk, concatBytes(previous, info, Uint8Array.of(counter)));
    output.push(previous);
    size += previous.length;
  }
  return concatBytes(...output).subarray(0, length);
}

function exportSigningJwk(jwk) {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
    ext: true,
    key_ops: ['sign'],
  };
}

async function createVapidJwt(endpoint, env) {
  const jwk = readVapidPrivateKey(env);
  if (!jwk) throw new Error('VAPID is not configured.');
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(utf8(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const payload = base64UrlEncode(utf8(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: 'https://sed-gg.vercel.app',
  })));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('jwk', exportSigningJwk(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(unsigned));
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function encryptWebPushPayload(subscription, payload) {
  const uaPublicBytes = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);
  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 4 || authSecret.length < 16) {
    throw new Error('Invalid Web Push subscription keys.');
  }
  const uaPublic = await crypto.subtle.importKey('raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const senderPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, senderPair.privateKey, 256));
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', senderPair.publicKey));
  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const ikm = await hkdfExpand(prkKey, concatBytes(utf8('WebPush: info\0'), uaPublicBytes, senderPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, utf8('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = concatBytes(utf8(JSON.stringify(payload)), Uint8Array.of(2));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concatBytes(salt, recordSize, Uint8Array.of(senderPublic.length), senderPublic, encrypted);
}

export async function sendWebPush(env, subscription, payload) {
  if (!validSubscription(subscription)) throw new Error('Invalid Web Push subscription.');
  const publicKey = getVapidPublicKey(env);
  if (!publicKey) throw new Error('VAPID is not configured.');
  const authorization = await createVapidJwt(subscription.endpoint, env);
  const body = await encryptWebPushPayload(subscription, payload);
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${authorization}, k=${publicKey}`,
      'Crypto-Key': `p256ecdsa=${publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  if (!response.ok) {
    const error = new Error(`Web Push endpoint returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return { success: true, status: response.status };
}

async function deleteSubscription(db, endpoint) {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint).run();
}

async function sendToRows(env, db, rows, payload) {
  const results = await Promise.all((rows || []).map(async (row) => {
    let subscription;
    try {
      subscription = typeof row.subscription_json === 'string' ? JSON.parse(row.subscription_json) : row.subscription_json;
      await sendWebPush(env, subscription, payload);
      return true;
    } catch (error) {
      if ((error?.status === 404 || error?.status === 410) && row.endpoint) {
        try { await deleteSubscription(db, row.endpoint); } catch {}
      }
      return false;
    }
  }));
  return results.filter(Boolean).length;
}

async function subscriptionsForUser(db, userRa) {
  const result = await db.prepare('SELECT endpoint,subscription_json FROM push_subscriptions WHERE user_ra=?')
    .bind(userRa).all();
  return result?.results || [];
}

async function handleSubscribe(request, env, deps) {
  const db = env?.SEDX_ADMIN;
  if (!db) return jsonResponse(deps, { ok: false, erro: 'Armazenamento push indisponível.' }, 503);
  const token = String(request.headers.get('X-Token') || '').trim();
  const token2 = String(request.headers.get('X-Token2') || '').trim();
  const cdUsuario = String(request.headers.get('X-Cd-Usuario') || '').trim();
  const userRa = normalizeUserRa(request.headers.get('X-Usuario'));
  if (!token || !token2 || !cdUsuario || !userRa) {
    return jsonResponse(deps, { ok: false, erro: 'Entre novamente para ativar as notificações.' }, 401);
  }
  let body;
  try { body = await request.json(); } catch { return jsonResponse(deps, { ok: false, erro: 'Solicitação inválida.' }, 400); }
  const subscription = body?.subscription;
  if (!validSubscription(subscription)) return jsonResponse(deps, { ok: false, erro: 'Assinatura push inválida ou não suportada.' }, 400);
  const old = await db.prepare('SELECT task_ids_json,session_ciphertext,session_iv FROM push_users WHERE user_ra=?')
    .bind(userRa).first();
  const oldEndpoint = await db.prepare('SELECT user_ra FROM push_subscriptions WHERE endpoint=?')
    .bind(subscription.endpoint).first();
  let previous = {};
  if (old?.session_ciphertext && old?.session_iv) {
    try { previous = await decryptSession(old, env); } catch { previous = {}; }
  }
  const timeZone = validTimeZone(body?.timeZone || body?.timezone);
  const session = {
    token,
    token2,
    cdUsuario,
    username: String(request.headers.get('X-Task-User') || '').trim().slice(0, 120),
    timeZone,
    lastTaskCheck: Number(previous.lastTaskCheck) || 0,
    lastAgendaAttempt: Number(previous.lastAgendaAttempt) || 0,
    scheduleCache: previous.scheduleCache || null,
  };
  let taskIdsJson = old?.task_ids_json ?? null;
  if (taskIdsJson === null && typeof deps?.fetchTasks === 'function') {
    try {
      const baseline = await deps.fetchTasks(token2, [], session.username);
      if (baseline?.ok) taskIdsJson = JSON.stringify((baseline.tasks || []).map(normalizeTaskId).filter(Boolean).slice(-MAX_SEEN_TASKS));
    } catch {}
  }
  let encrypted;
  try { encrypted = await encryptSession(session, env); }
  catch { return jsonResponse(deps, { ok: false, erro: 'A configuração segura das notificações está incompleta.' }, 503); }
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO push_users (user_ra,session_ciphertext,session_iv,task_ids_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(user_ra) DO UPDATE SET session_ciphertext=excluded.session_ciphertext,
    session_iv=excluded.session_iv,task_ids_json=COALESCE(push_users.task_ids_json,excluded.task_ids_json),updated_at=excluded.updated_at`)
    .bind(userRa, encrypted.ciphertext, encrypted.iv, taskIdsJson, now, now).run();
  await db.prepare(`INSERT INTO push_subscriptions (endpoint,user_ra,subscription_json,created_at) VALUES (?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_ra=excluded.user_ra,subscription_json=excluded.subscription_json`)
    .bind(subscription.endpoint, userRa, JSON.stringify(subscription), now).run();
  if (oldEndpoint?.user_ra && oldEndpoint.user_ra !== userRa) {
    const remaining = await db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_ra=?')
      .bind(oldEndpoint.user_ra).first();
    if (!(Number(remaining?.total) > 0)) {
      await db.prepare('DELETE FROM push_users WHERE user_ra=?').bind(oldEndpoint.user_ra).run();
    }
  }
  return jsonResponse(deps, { ok: true, enabled: true });
}

async function handleUnsubscribe(request, env, deps) {
  const db = env?.SEDX_ADMIN;
  if (!db) return jsonResponse(deps, { ok: false, erro: 'Armazenamento push indisponível.' }, 503);
  let body;
  try { body = await request.json(); } catch { return jsonResponse(deps, { ok: false, erro: 'Solicitação inválida.' }, 400); }
  const endpoint = String(body?.endpoint || body?.subscription?.endpoint || '').trim();
  if (!validPushEndpoint(endpoint)) return jsonResponse(deps, { ok: false, erro: 'Endpoint push inválido.' }, 400);
  const existing = await db.prepare('SELECT user_ra FROM push_subscriptions WHERE endpoint=?').bind(endpoint).first();
  await deleteSubscription(db, endpoint);
  if (existing?.user_ra) {
    const remaining = await db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_ra=?')
      .bind(existing.user_ra).first();
    if (!(Number(remaining?.total) > 0)) {
      await db.prepare('DELETE FROM push_users WHERE user_ra=?').bind(existing.user_ra).run();
    }
  }
  return jsonResponse(deps, { ok: true, enabled: false });
}

export async function handlePushRoute(request, env, url, deps = {}) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path === '/push/config' && request.method === 'GET') {
    const publicKey = getVapidPublicKey(env);
    if (!publicKey) return jsonResponse(deps, { ok: false, erro: 'Notificações push ainda não foram configuradas.' }, 503);
    return jsonResponse(deps, { ok: true, publicKey });
  }
  if (path === '/push/subscribe' && request.method === 'POST') return handleSubscribe(request, env, deps);
  if (path === '/push/unsubscribe' && request.method === 'POST') return handleUnsubscribe(request, env, deps);
  return null;
}

function parseTaskIds(value) {
  try {
    const ids = JSON.parse(value || '[]');
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}

function reminderPayload(firstClass) {
  const subject = String(firstClass?.nomeDisciplina || firstClass?.disciplina || 'aula').trim().slice(0, 100);
  const time = String(firstClass?.horaInicio || '').slice(0, 5);
  return {
    title: 'Sua aula começa em 1 hora',
    body: `Hoje você tem ${subject} às ${time}. Sua presença é muito importante.`,
    tag: `class-reminder-${String(firstClass?.data || firstClass?.date || '').slice(0, 10)}`,
    data: { url: '/', type: 'class-reminder' },
  };
}

function noticePayload(notice) {
  return {
    title: String(notice?.title || 'Novo aviso no SedX').trim().slice(0, 120),
    body: String(notice?.description || 'Confira a nova publicação no SedX.').trim().slice(0, 220),
    tag: `notice-${String(notice?.id || Date.now()).slice(0, 100)}`,
    data: { url: '/', type: 'notice' },
  };
}

function taskPayload(task, id) {
  return {
    title: `Nova tarefa: ${normalizeTaskTitle(task)}`,
    body: 'Uma nova tarefa foi disponibilizada. Toque para conferir no SedX.',
    tag: `task-${String(id).slice(0, 100)}`,
    data: { url: '/', type: 'task', taskId: String(id) },
  };
}

async function persistSession(db, userRa, session, taskIdsJson, env) {
  const encrypted = await encryptSession(session, env);
  await db.prepare(`UPDATE push_users SET session_ciphertext=?,session_iv=?,task_ids_json=?,updated_at=? WHERE user_ra=?`)
    .bind(encrypted.ciphertext, encrypted.iv, taskIdsJson, new Date().toISOString(), userRa).run();
}

async function sendClassReminder(db, env, userRa, rows, localDate, firstClass) {
  const claim = await db.prepare('INSERT OR IGNORE INTO push_daily_log (user_ra,local_date,kind,sent_at) VALUES (?,?,?,?)')
    .bind(userRa, localDate, 'class-reminder', new Date().toISOString()).run();
  const changes = Number(claim?.meta?.changes ?? claim?.changes ?? 0);
  if (!changes) return 0;
  const sent = await sendToRows(env, db, rows, reminderPayload(firstClass));
  if (!sent) {
    await db.prepare('DELETE FROM push_daily_log WHERE user_ra=? AND local_date=? AND kind=?')
      .bind(userRa, localDate, 'class-reminder').run();
  }
  return sent;
}

export async function runPushScheduled(controller, env, deps = {}) {
  const db = env?.SEDX_ADMIN;
  if (!db || !getVapidPublicKey(env) || !env.PUSH_SESSION_ENCRYPTION_KEY) return { processed: 0 };
  const query = await db.prepare(`SELECT u.user_ra,u.session_ciphertext,u.session_iv,u.task_ids_json,u.created_at,u.updated_at,
      s.endpoint,s.subscription_json
    FROM push_users u JOIN push_subscriptions s ON s.user_ra=u.user_ra
    ORDER BY u.updated_at ASC LIMIT 100`).all();
  const grouped = new Map();
  for (const row of query?.results || []) {
    if (!grouped.has(row.user_ra)) grouped.set(row.user_ra, { user: row, subscriptions: [] });
    grouped.get(row.user_ra).subscriptions.push({ endpoint: row.endpoint, subscription_json: row.subscription_json });
  }
  const users = [...grouped.values()].slice(0, MAX_USERS_PER_TICK);
  let processed = 0;
  for (const { user, subscriptions } of users) {
    try {
      const session = await decryptSession(user, env);
      const now = new Date();
      const timeZone = validTimeZone(session.timeZone);
      const local = localParts(now, timeZone);
      let taskIdsJson = user.task_ids_json ?? null;
      let schedule = session.scheduleCache || null;

      if (local.weekday !== 'Sat' && local.weekday !== 'Sun' && schedule?.date !== local.date) {
        const lastAttempt = Number(session.lastAgendaAttempt) || 0;
        if (Date.now() - lastAttempt >= 10 * 60 * 1000 && typeof deps.fetchAgendaDia === 'function' && session.token && session.cdUsuario) {
          session.lastAgendaAttempt = Date.now();
          try {
            const agenda = await deps.fetchAgendaDia(session.cdUsuario, session.token, local.date);
            if (agenda?.ok) {
              const firstClass = selectFirstClass(agenda.events, local.date);
              schedule = firstClass
                ? { date: local.date, time: String(firstClass.horaInicio).slice(0, 5), subject: String(firstClass.nomeDisciplina || 'aula').slice(0, 100) }
                : { date: local.date, time: null, subject: null };
              session.scheduleCache = schedule;
            }
          } catch {}
        }
      } else if (local.weekday === 'Sat' || local.weekday === 'Sun') {
        schedule = { date: local.date, time: null, subject: null };
        session.scheduleCache = schedule;
      }

      if (schedule?.date === local.date && schedule?.time && isClassReminderDue(schedule.time, now, timeZone)) {
        const firstClass = { data: local.date, horaInicio: schedule.time, nomeDisciplina: schedule.subject };
        await sendClassReminder(db, env, user.user_ra, subscriptions, local.date, firstClass);
      }

      const noticeRows = await db.prepare(`SELECT n.id,n.title,n.description FROM notifications n
        LEFT JOIN push_notice_deliveries d ON d.notice_id=n.id AND d.user_ra=?
        WHERE n.published_at>? AND n.published_at<=? AND d.notice_id IS NULL
        ORDER BY n.published_at ASC LIMIT 1`)
        .bind(user.user_ra, user.created_at, now.toISOString()).all();
      for (const notice of noticeRows?.results || []) {
        const sent = await sendToRows(env, db, subscriptions, noticePayload(notice));
        if (sent > 0) {
          await db.prepare('INSERT OR IGNORE INTO push_notice_deliveries (user_ra,notice_id,sent_at) VALUES (?,?,?)')
            .bind(user.user_ra, notice.id, new Date().toISOString()).run();
        }
      }

      const lastTaskCheck = Number(session.lastTaskCheck) || 0;
      if (Date.now() - lastTaskCheck >= TASK_POLL_MS && typeof deps.fetchTasks === 'function' && session.token2) {
        session.lastTaskCheck = Date.now();
        try {
          const result = await deps.fetchTasks(session.token2, [], session.username || '');
          if (result?.ok) {
            const tasks = Array.isArray(result.tasks) ? result.tasks : [];
            const known = parseTaskIds(taskIdsJson);
            const idsNow = tasks.map((task) => ({ task, id: normalizeTaskId(task) })).filter(({ id }) => id);
            if (taskIdsJson === null) {
              for (const { id } of idsNow) known.add(id);
            } else {
              for (const { task, id } of idsNow) {
                if (known.has(id)) continue;
                const sent = await sendToRows(env, db, subscriptions, taskPayload(task, id));
                if (sent > 0) known.add(id);
              }
            }
            taskIdsJson = JSON.stringify([...known].slice(-MAX_SEEN_TASKS));
          }
        } catch {}
      }
      await persistSession(db, user.user_ra, session, taskIdsJson, env);
      processed += 1;
    } catch {
      // Uma sessão inválida não deve impedir o processamento de outras pessoas.
      processed += 1;
    }
  }
  return { processed, totalUsers: grouped.size, cron: controller?.cron || '' };
}

export const pushInternals = Object.freeze({
  base64UrlEncode,
  base64UrlDecode,
  normalizeUserRa,
  normalizeTaskId,
  validPushEndpoint,
  validSubscription,
  encryptWebPushPayload,
  createVapidJwt,
  localParts,
  taskPayload,
  reminderPayload,
});

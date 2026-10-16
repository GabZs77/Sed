import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getVapidPublicKey,
  handlePushRoute,
  isClassReminderDue,
  pushInternals,
  runPushScheduled,
  sendWebPush,
  selectFirstClass,
} from './push-worker.mjs';

const pushSource = await readFile(new URL('./push-worker.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(pushSource, /\b(fetchTasks|taskPayload|normalizeTaskId|task_ids_json)\b/);

const NativeDate = globalThis.Date;
let clock = NativeDate.parse('2026-10-16T10:00:00.000Z'); // 07:00 em America/Sao_Paulo.
class FixedDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
globalThis.Date = FixedDate;

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, ' ').trim(); this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() { return this.db.first(this.sql, this.params); }
  async all() { return this.db.all(this.sql, this.params); }
  async run() { return this.db.run(this.sql, this.params); }
}

class FakeD1 {
  constructor() {
    this.users = new Map();
    this.subscriptions = new Map();
    this.dailyLogs = new Set();
    this.notifications = [];
    this.noticeDeliveries = new Set();
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  async first(sql, params) {
    if (sql.includes('FROM push_users WHERE user_ra=?')) return this.users.get(params[0]) || null;
    if (sql.includes('FROM push_subscriptions WHERE endpoint=?')) {
      const row = this.subscriptions.get(params[0]);
      return row ? { user_ra: row.user_ra } : null;
    }
    if (sql.includes('COUNT(*) AS total FROM push_subscriptions')) {
      return { total: [...this.subscriptions.values()].filter((row) => row.user_ra === params[0]).length };
    }
    return null;
  }
  async all(sql, params) {
    if (sql.includes('FROM notifications n LEFT JOIN push_notice_deliveries')) {
      const [userRa, createdAt, now] = params;
      return { results: this.notifications
        .filter((notice) => notice.published_at > createdAt && notice.published_at <= now && !this.noticeDeliveries.has(`${userRa}|${notice.id}`))
        .slice(0, 1) };
    }
    if (sql.includes('JOIN push_subscriptions')) {
      const rows = [];
      for (const user of this.users.values()) {
        for (const sub of this.subscriptions.values()) {
          if (sub.user_ra === user.user_ra) rows.push({ ...user, endpoint: sub.endpoint, subscription_json: sub.subscription_json });
        }
      }
      return { results: rows };
    }
    if (sql === 'SELECT endpoint,subscription_json FROM push_subscriptions') return { results: [...this.subscriptions.values()] };
    if (sql.includes('FROM push_subscriptions WHERE user_ra=?')) {
      return { results: [...this.subscriptions.values()].filter((row) => row.user_ra === params[0]) };
    }
    return { results: [] };
  }
  async run(sql, params) {
    if (sql.startsWith('INSERT INTO push_users')) {
      const [user_ra, session_ciphertext, session_iv, created_at, updated_at] = params;
      const old = this.users.get(user_ra);
      this.users.set(user_ra, { user_ra, session_ciphertext, session_iv, created_at: old?.created_at || created_at, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO push_subscriptions')) {
      const [endpoint, user_ra, subscription_json, created_at] = params;
      this.subscriptions.set(endpoint, { endpoint, user_ra, subscription_json, created_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE push_users')) {
      const [session_ciphertext, session_iv, updated_at, user_ra] = params;
      const old = this.users.get(user_ra);
      if (old) this.users.set(user_ra, { ...old, session_ciphertext, session_iv, updated_at });
      return { success: true, meta: { changes: old ? 1 : 0 } };
    }
    if (sql.startsWith('INSERT OR IGNORE INTO push_daily_log')) {
      const key = params.slice(0, 3).join('|');
      if (this.dailyLogs.has(key)) return { success: true, meta: { changes: 0 } };
      this.dailyLogs.add(key);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM push_daily_log')) {
      this.dailyLogs.delete(params.join('|'));
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT OR IGNORE INTO push_notice_deliveries')) {
      const key = `${params[0]}|${params[1]}`;
      if (this.noticeDeliveries.has(key)) return { success: true, meta: { changes: 0 } };
      this.noticeDeliveries.add(key);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM push_subscriptions')) {
      const deleted = this.subscriptions.delete(params[0]);
      return { success: true, meta: { changes: deleted ? 1 : 0 } };
    }
    if (sql.startsWith('DELETE FROM push_users')) {
      const deleted = this.users.delete(params[0]);
      return { success: true, meta: { changes: deleted ? 1 : 0 } };
    }
    throw new Error(`Unexpected D1 query in test: ${sql}`);
  }
}

const crypto = globalThis.crypto;
const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidJwk = await crypto.subtle.exportKey('jwk', vapidPair.privateKey);
const sessionKey = crypto.getRandomValues(new Uint8Array(32));
const env = {
  SEDX_ADMIN: new FakeD1(),
  PUSH_VAPID_PRIVATE_JWK: JSON.stringify(vapidJwk),
  PUSH_SESSION_ENCRYPTION_KEY: pushInternals.base64UrlEncode(sessionKey),
};
assert.ok(getVapidPublicKey(env), 'A chave pública VAPID deve ser derivada da chave privada.');

const userAgentKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-token',
  expirationTime: null,
  keys: {
    p256dh: pushInternals.base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', userAgentKeys.publicKey))),
    auth: pushInternals.base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
  },
};

let pushRequests = [];
const originalFetch = globalThis.fetch;
let agendaCalls = 0;
globalThis.fetch = async (url, options) => {
  pushRequests.push({ url: String(url), options });
  return new Response(null, { status: 201 });
};
try {
  const configResponse = await handlePushRoute(new Request('https://worker.example/push/config'), env, new URL('https://worker.example/push/config'));
  assert.equal(configResponse.status, 200);
  assert.equal((await configResponse.json()).publicKey, getVapidPublicKey(env));

  const headers = new Headers({
    'X-Token': 'sed-session-token-test',
    'X-Token2': 'edusp-session-token-test',
    'X-Cd-Usuario': '1234567',
    'X-Usuario': '123456789A',
  });
  const subscribeResponse = await handlePushRoute(new Request('https://worker.example/push/subscribe', {
    method: 'POST', headers,
    body: JSON.stringify({ subscription, timeZone: 'America/Sao_Paulo' }),
  }), env, new URL('https://worker.example/push/subscribe'));
  assert.equal(subscribeResponse.status, 200);
  assert.equal((await subscribeResponse.json()).enabled, true);
  const storedUser = env.SEDX_ADMIN.users.get('123456789A');
  assert.ok(storedUser);
  assert.ok(!storedUser.session_ciphertext.includes('edusp-session-token-test'), 'A sessão não pode ficar legível no D1.');
  assert.ok(env.SEDX_ADMIN.subscriptions.has(subscription.endpoint));

  // Avança um minuto: a aula começa às 08:01 local e o lembrete deve sair às 07:01.
  clock += 60 * 1000;
  env.SEDX_ADMIN.notifications.push({
    id: 'notice-1', title: 'Aviso novo', description: 'Confira o comunicado.', published_at: new Date().toISOString(),
  });
  const fetchAgendaDia = async () => {
    agendaCalls += 1;
    return { ok: true, events: [{ data: '2026-10-16', horaInicio: '08:01', tipo: 'aula', nomeDisciplina: 'Matemática' }] };
  };
  const firstTick = await runPushScheduled({ cron: '* * * * *' }, env, { fetchAgendaDia });
  assert.equal(firstTick.processed, 1);
  assert.equal(pushRequests.length, 2, 'Devem ser enviados um lembrete de aula e um aviso.');
  assert.equal(agendaCalls, 1);
  assert.ok(env.SEDX_ADMIN.noticeDeliveries.has('123456789A|notice-1'));
  assert.ok(env.SEDX_ADMIN.dailyLogs.has('123456789A|2026-10-16|class-reminder'));
  assert.match(pushRequests[0].options.headers.Authorization, /^vapid t=/);
  assert.equal(pushRequests[0].options.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(pushRequests[0].options.body.byteLength > 80, 'O payload deve estar cifrado.');

  await runPushScheduled({ cron: '* * * * *' }, env, { fetchAgendaDia });
  assert.equal(pushRequests.length, 2, 'Nem o mesmo aviso nem o lembrete diário podem ser duplicados.');
  assert.equal(agendaCalls, 1, 'A agenda do dia deve ser consultada apenas uma vez no intervalo cacheado.');

  const unsubscribed = await handlePushRoute(new Request('https://worker.example/push/unsubscribe', {
    method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }),
  }), env, new URL('https://worker.example/push/unsubscribe'));
  assert.equal(unsubscribed.status, 200);
  assert.equal(env.SEDX_ADMIN.subscriptions.size, 0);
  assert.equal(env.SEDX_ADMIN.users.size, 0, 'Ao desativar o último dispositivo, os tokens cifrados devem ser removidos.');

  const fridayClass = { data: '2026-10-16', horaInicio: '07:00', tipo: 'aula', nomeDisciplina: 'Matemática' };
  assert.equal(selectFirstClass([fridayClass, { ...fridayClass, horaInicio: '08:00' }], '2026-10-16').horaInicio, '07:00');
  assert.equal(isClassReminderDue('07:00', new NativeDate('2026-10-16T09:00:00Z'), 'America/Sao_Paulo'), true);
  assert.equal(isClassReminderDue('07:00', new NativeDate('2026-10-16T10:00:00Z'), 'America/Sao_Paulo'), false);
  assert.equal(isClassReminderDue('07:00', new NativeDate('2026-10-17T09:00:00Z'), 'America/Sao_Paulo'), false, 'Não deve haver lembrete no fim de semana.');

  // Testa a criptografia ECDH/HKDF/AES-GCM e a assinatura VAPID.
  await sendWebPush(env, subscription, { title: 'Teste', body: 'Conteúdo protegido' });
  assert.equal(pushRequests.length, 3);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.Date = NativeDate;
}

console.log('OK: avisos publicados, lembrete único de aula e módulo sem integração adicional.');

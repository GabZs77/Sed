import assert from "node:assert/strict";
import { handleAboutRequest, normalizeAboutDocument, defaultAboutDocument } from "./about-worker.mjs";

const ADMIN_RA = "1234567890";
const ADMIN_SHORT = "123456789";
const settings = new Map();
const auditRows = [];
let upstreamIdentity = ADMIN_RA;
let upstreamCalls = 0;
let shortProfileEmpty = false;
const requestedCodes = [];
let networkDown = false;

class FakeStatement {
  constructor(sql) { this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    if (this.sql.includes("FROM admin_users")) return this.params[0] === ADMIN_RA ? { ra: ADMIN_RA } : null;
    if (this.sql.includes("SELECT value FROM site_settings")) {
      const value = settings.get(this.params[0]);
      return value === undefined ? null : { value };
    }
    return null;
  }
  async all() {
    if (this.sql.includes("SELECT key, value FROM site_settings")) {
      const prefix = this.params[0].replace(/%$/, "");
      const results = [...settings.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([key, value]) => ({ key, value }));
      return { results };
    }
    return { results: [] };
  }
  async run() {
    if (this.sql.includes("INSERT INTO site_settings")) settings.set(this.params[0], this.params[1]);
    else if (this.sql.includes("DELETE FROM site_settings")) settings.delete(this.params[0]);
    else if (this.sql.includes("INSERT INTO audit_logs")) auditRows.push(this.params);
    return { success: true };
  }
}

const env = { SEDX_ADMIN: { prepare: (sql) => new FakeStatement(sql) } };
globalThis.fetch = async (url, options) => {
  upstreamCalls += 1;
  const code = new URL(String(url)).searchParams.get("codigoAluno");
  if (code) requestedCodes.push(code);
  if (networkDown) throw new Error("upstream unavailable");
  assert.match(String(url), /ObterAlunoPorCodigo/);
  assert.equal(options.headers.Authorization, "Bearer test-sed-token");
  assert.equal(options.headers["Ocp-Apim-Subscription-Key"], "test-subscription-key");
  if (!String(url).includes("/saladofuturobffapi/")) return new Response("not found", { status: 404 });
  const profile = shortProfileEmpty && code === ADMIN_SHORT ? { data: { nome: "Aluno" } } : { data: { ra: upstreamIdentity } };
  return new Response(JSON.stringify(profile), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

function request(path, method = "GET", body, authenticated = true) {
  const headers = new Headers({ Origin: "https://sed-gg.vercel.app" });
  if (authenticated) {
    headers.set("X-Admin-User", ADMIN_RA);
    headers.set("X-Usuario", ADMIN_RA);
    headers.set("X-Cd-Usuario", ADMIN_SHORT);
    headers.set("X-Token", "test-sed-token");
    headers.set("X-Token2", "test-edusp-key");
  }
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`https://worker.test${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function call(path, method, body, authenticated = true) {
  const req = request(path, method, body, authenticated);
  return handleAboutRequest(req, env, new URL(req.url), "test-subscription-key");
}

const noContent = await call("/about", "GET");
assert.equal(noContent.status, 200);
assert.equal((await noContent.json()).published, false);

const adminLoad = await call("/admin/about", "GET");
assert.equal(adminLoad.status, 200);
const adminPayload = await adminLoad.json();
assert.equal(adminPayload.isAdmin, true);
assert.equal(adminPayload.draft.sections[0].title, "O que torna o SEDX diferente?");

const draft = defaultAboutDocument();
draft.title = "Sobre atualizado";
draft.sections[0].buttons = [{ label: "Site seguro", url: "https://example.com" }, { label: "Bloqueado", url: "javascript:alert(1)" }];
const save = await call("/admin/about/draft", "PUT", draft);
assert.equal(save.status, 200);
assert.equal((await save.json()).draft.buttons, undefined);
assert.equal(settings.has("about:published"), false, "salvar rascunho não publica");
const storedDraft = JSON.parse(settings.get("about:draft"));
assert.equal(storedDraft.title, "Sobre atualizado");
assert.equal(storedDraft.sections[0].buttons.length, 1, "URLs não HTTP devem ser descartadas");

const publish = await call("/admin/about/publish", "POST", {});
assert.equal(publish.status, 200);
const publishedData = await publish.json();
assert.equal(publishedData.published.content.title, "Sobre atualizado");
assert.equal(publishedData.versions.length, 1);
const firstVersionId = publishedData.published.id;
const publicPage = await call("/about", "GET", undefined, false);
assert.equal((await publicPage.json()).content.title, "Sobre atualizado");

const secondDraft = { ...storedDraft, title: "Nova versão" };
assert.equal((await call("/admin/about/draft", "PUT", secondDraft)).status, 200);
const secondPublish = await call("/admin/about/publish", "POST", {});
assert.equal(secondPublish.status, 200);
assert.equal((await secondPublish.json()).versions.length, 2);

const restore = await call("/admin/about/restore", "POST", { versionId: firstVersionId });
assert.equal(restore.status, 200);
assert.equal((await restore.json()).draft.title, "Sobre atualizado");
assert.equal(JSON.parse(settings.get("about:published")).content.title, "Nova versão", "restaurar mantém publicação intacta");

const unpublish = await call("/admin/about/unpublish", "POST", {});
assert.equal(unpublish.status, 200);
assert.equal(settings.has("about:published"), false);
assert.equal([...settings.keys()].filter((key) => key.startsWith("about:version:")).length, 2, "histórico preservado ao despublicar");
assert.ok(auditRows.length >= 5);

const callsBeforeSpoof = upstreamCalls;
upstreamIdentity = "9999999999";
const spoofed = await call("/admin/about", "GET");
assert.equal(spoofed.status, 403, "a identidade devolvida pelo SED precisa corresponder ao administrador");
assert.ok(upstreamCalls > callsBeforeSpoof);
upstreamIdentity = ADMIN_RA;
shortProfileEmpty = true;
const callsBeforeFallback = upstreamCalls;
const fullRaFallback = await call("/admin/about", "GET");
assert.equal(fullRaFallback.status, 200, "deve tentar o RA completo se a busca pelo código curto não identificar o perfil");
assert.ok(upstreamCalls >= callsBeforeFallback + 4, "deve testar o código curto e o RA completo nas duas rotas SED");
assert.ok(requestedCodes.includes(ADMIN_RA), "a tentativa de fallback deve consultar o RA completo");
shortProfileEmpty = false;
const noSession = await call("/admin/about", "GET", undefined, false);
assert.equal(noSession.status, 403);
const configuredAdminRa = "1127241606";
upstreamIdentity = configuredAdminRa;
const configuredAdminHeaders = new Headers({
  Origin: "https://sed-gg.vercel.app",
  "X-Admin-User": configuredAdminRa,
  "X-Usuario": configuredAdminRa,
  "X-Cd-Usuario": configuredAdminRa,
  "X-Token": "test-sed-token",
  "X-Token2": "test-edusp-key",
});
const configuredAdminRequest = new Request("https://worker.test/admin/about", { headers: configuredAdminHeaders });
const configuredAdmin = await handleAboutRequest(configuredAdminRequest, env, new URL(configuredAdminRequest.url), "test-subscription-key");
assert.equal(configuredAdmin.status, 200, "administrador configurado na interface não deve depender de uma linha em admin_users");
upstreamIdentity = ADMIN_RA;
networkDown = true;
const unavailable = await call("/admin/about", "GET");
assert.equal(unavailable.status, 503, "falha de rede é distinguida de falta de permissão");
networkDown = false;

const oversized = "data:image/webp;base64," + "A".repeat(700_001);
assert.throws(() => normalizeAboutDocument({ title: "Teste", sections: [{ title: "Imagem", image: oversized }] }), /inválido|excede/i);
assert.throws(() => normalizeAboutDocument({ title: "Teste", sections: Array.from({ length: 31 }, (_, i) => ({ title: `Seção ${i}` })) }), /no máximo/i);

console.log("test-about-worker: autorização, rascunho, publicação, histórico, restauração e limites aprovados.");

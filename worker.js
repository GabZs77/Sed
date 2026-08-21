/*
 * Flash / Sala do Futuro — Cloudflare Worker
 * Backend convertido do server.py para Cloudflare Workers + Browser Run + Playwright.
 *
 * IMPORTANTE:
 * 1) O Worker precisa de um Browser Binding chamado BROWSER.
 * 2) A dependência @cloudflare/playwright precisa estar disponível no build do Worker.
 * 3) Crie um secret chamado SED_KEY com a chave Ocp-Apim-Subscription-Key usada pelo seu projeto.
 *
 * O session_id retornado pelo login é o ID da sessão do Browser Run. A sessão é reutilizada
 * entre as chamadas até expirar por inatividade.
 */

import { acquire, connect } from "@cloudflare/playwright";

const SITE = "https://saladofuturo.educacao.sp.gov.br";
const BFF = "https://sedintegracoes.educacao.sp.gov.br/saladofuturobffapi";
const CMSP_API = "https://edusp-api.ip.tv";
const CMSP_SITE = "https://cmsp.ip.tv";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ROBO_ROUTES = ["/home", "/boletim", "/presenca", "/agenda", "/tarefas", "/materiais"];

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...extra,
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(extra) },
  });
}

function parseRA(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s/g, "");
  const cleanSP = raw.replace(/SP$/, "");
  let digito = "";
  let clean = cleanSP;
  if (clean.length >= 10 && /\d$/.test(clean)) {
    digito = clean.slice(-1);
    clean = clean.slice(0, -1);
  }
  clean = clean.replace(/\D/g, "");
  return { clean, digito, completo: `${clean}${digito}SP` };
}

async function getBrowser(env, sessionId) {
  if (sessionId) {
    try {
      const browser = await connect(env.BROWSER, sessionId);
      return { browser, sessionId };
    } catch (_) {}
  }
  const acquired = await acquire(env.BROWSER);
  const browser = await connect(env.BROWSER, acquired.sessionId);
  return { browser, sessionId: acquired.sessionId };
}

async function getPage(browser) {
  const contexts = browser.contexts();
  let context = contexts[0];
  if (!context) context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: USER_AGENT,
    locale: "pt-BR",
  });
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  return { context, page };
}

async function closeConnection(browser) {
  try { await browser.close(); } catch (_) {}
}

function flatten(obj, out = []) {
  if (Array.isArray(obj)) for (const x of obj) flatten(x, out);
  else if (obj && typeof obj === "object") {
    out.push(obj);
    for (const v of Object.values(obj)) flatten(v, out);
  }
  return out;
}

function findValue(obj, names) {
  const wanted = names.map(x => x.toLowerCase());
  for (const node of flatten(obj)) {
    for (const [k, v] of Object.entries(node)) {
      const kl = String(k).toLowerCase();
      if (wanted.some(n => kl === n || kl.includes(n))) {
        if (typeof v === "string" && v.trim()) return v;
      }
    }
  }
  return "";
}

function findToken(data) {
  return findValue(data, ["token", "access_token", "accesstoken", "jwt", "authorization"]);
}
function findSedToken(data) {
  return findValue(data, ["sedtoken", "sed_token", "sed-token", "tokenSed"]);
}
function findIptvToken(data) {
  return findValue(data, ["iptvtoken", "iptv_token", "autenticacao.iptvtoken"]);
}
function findSecureToken(data) {
  return findValue(data, ["securetoken", "secure_token"]);
}
function findCodigo(data) {
  return findValue(data, ["codigoaluno", "codigo_aluno", "cdaluno", "cd_aluno"]);
}
function findName(data) {
  return findValue(data, ["nomealuno", "nome_aluno", "nome"]);
}
function findProfile(data) {
  for (const node of flatten(data)) {
    const keys = Object.keys(node).map(k => k.toLowerCase());
    if (keys.some(k => k.includes("nome")) && keys.some(k => k.includes("aluno"))) return node;
  }
  return {};
}

async function storageData(page) {
  return await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const raw = localStorage.getItem(k);
      try { out[k] = JSON.parse(raw); } catch (_) { out[k] = raw; }
    }
    return out;
  });
}

async function visibleError(page) {
  try {
    return await page.evaluate(() => {
      const sels = '[role="alert"], .toast, .alert, .error, .error-message, .mensagem-erro, .erro, .notification';
      for (const el of document.querySelectorAll(sels)) {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        if (s.display === "none" || s.visibility === "hidden" || r.width < 10 || r.height < 10) continue;
        const t = (el.innerText || "").trim();
        if (t.length > 3 && t.length < 300) return t;
      }
      return "";
    });
  } catch (_) { return ""; }
}

async function login(env, raInput, senha) {
  const { clean, digito, completo } = parseRA(raInput);
  const acquired = await acquire(env.BROWSER);
  const browser = await connect(env.BROWSER, acquired.sessionId);
  const { context, page } = await getPage(browser);

  try {
    await page.goto(`${SITE}/login-alunos`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1800);

    await page.locator("#input-usuario-sed").fill(clean);
    if (digito) {
      const sels = ['input[name="digito-ra"]', '#input-digito', 'input[placeholder*="dígito"]', 'input[placeholder*="digito"]', 'input[maxlength="2"]'];
      for (const sel of sels) {
        const els = await page.locator(sel).all();
        let filled = false;
        for (const el of els) {
          if (await el.isVisible().catch(() => false)) { await el.fill(digito); filled = true; break; }
        }
        if (filled) break;
      }
    }
    await page.locator("#input-senha").fill(senha);
    const buttons = ['button:has-text("Acessar")', 'button:has-text("Entrar")', 'button:has-text("Login")'];
    let clicked = false;
    for (const sel of buttons) {
      try { await page.locator(sel).first().click({ timeout: 4000 }); clicked = true; break; } catch (_) {}
    }
    if (!clicked) throw new Error("Botão de login não encontrado.");

    let ok = false;
    let loginErr = "";
    for (let i = 0; i < 22; i++) {
      await page.waitForTimeout(900);
      const url = page.url();
      const text = await page.locator("body").innerText().catch(() => "");
      if (["Tarefa SP", "Boletim", "Home", "Presença", "Agenda", "Perfil", "Materiais", "Redação"].some(x => text.includes(x)) || !url.toLowerCase().includes("/login")) {
        ok = true; break;
      }
      const toast = await visibleError(page);
      if (toast && /(inválid|incorret|senha errada|credenciais|bloquead|usuário ou senha|usuario ou senha)/i.test(toast)) {
        loginErr = /bloquead/i.test(toast) ? "Conta bloqueada. Tente mais tarde." : "RA ou senha inválidos.";
        break;
      }
    }
    if (!ok) throw new Error(loginErr || "Falha no login. Verifique RA e senha.");

    await page.waitForTimeout(1200);
    const allData = await storageData(page);
    const token = findToken(allData);
    const sedToken = findSedToken(allData) || token;
    const iptvToken = findIptvToken(allData);
    const secureToken = findSecureToken(allData);
    const codigoAluno = findCodigo(allData);
    let nome = findName(allData);
    if (!nome) nome = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const m = text.match(/(?:Olá|Olá,|Bem-vindo|Bem vindo)[,:]?\s+([^\n]{2,80})/i);
      return m ? m[1].trim() : "";
    }).catch(() => "");

    // Guarda dados pequenos na própria página para o próximo request da mesma sessão.
    await page.evaluate(({ token, sedToken, iptvToken, secureToken, codigoAluno, nome, ra }) => {
      window.__FLASH_SESSION__ = { token, sedToken, iptvToken, secureToken, codigoAluno, nome, ra };
    }, { token, sedToken, iptvToken, secureToken, codigoAluno, nome, ra: completo });

    return { session_id: acquired.sessionId, nome: nome || "Aluno", ra: completo };
  } finally {
    // Em Playwright, close() em uma sessão conectada apenas desconecta; a sessão Browser Run permanece viva.
    await closeConnection(browser);
  }
}

async function sessionInfo(env, sid) {
  const { browser } = await getBrowser(env, sid);
  try {
    const { page } = await getPage(browser);
    const data = await page.evaluate(() => window.__FLASH_SESSION__ || null).catch(() => null);
    if (!data) return null;
    return { browser, page, data };
  } catch (e) {
    await closeConnection(browser);
    throw e;
  }
}

async function browserFetch(page, url, method, body, headers = {}) {
  return await page.evaluate(async ({ url, method, body, headers }) => {
    try {
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers,
        body: body == null ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { data = text; }
      return { ok: true, status: r.status, data };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, { url, method, body, headers });
}

async function fetchSed(page, env, session, method, path, body = null, params = null) {
  const url = new URL(BFF + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  const token = session.sedToken || session.token || "";
  const headers = {
    "Content-Type": "application/json",
    "Ocp-Apim-Subscription-Key": env.SED_KEY || "",
    "Authorization": `Bearer ${token}`,
    "Origin": SITE,
    "Referer": SITE + "/",
  };
  const result = await browserFetch(page, url.toString(), method, body, headers);
  if (result.ok && ![401,403].includes(result.status)) return result.data;
  return null;
}

async function fetchCmsp(page, session, method, path, body = null, params = null) {
  const url = new URL(CMSP_API + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  const auth = session.iptvToken || session.secureToken || session.token || "";
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${auth}`,
    "_auth_token": auth,
    "secure_token": session.secureToken || "",
    "x-api-platform": "web",
    "x-captcha-token": "",
  };
  const result = await browserFetch(page, url.toString(), method, body, headers);
  if (result.ok && ![401,403].includes(result.status)) return result.data;
  return null;
}

function pickRealResponse(captured) {
  for (const items of Object.values(captured || {})) {
    for (const item of items || []) {
      const data = item && typeof item === "object" ? (item.data ?? item.Data ?? item) : item;
      if ((Array.isArray(data) && data.length) || (data && typeof data === "object" && Object.keys(data).length)) return item;
    }
  }
  return null;
}

async function capturePage(page, route, fragments, wait = 5000) {
  const captured = {};
  const handler = async response => {
    try {
      if (!fragments.some(f => response.url().includes(f))) return;
      const ct = response.headers()["content-type"] || "";
      if (!ct.includes("json")) return;
      const data = await response.json();
      if (!captured[response.url()]) captured[response.url()] = [];
      captured[response.url()].push(data);
    } catch (_) {}
  };
  page.on("response", handler);
  try {
    await page.goto(SITE + route, { waitUntil: "domcontentloaded", timeout: 35000 }).catch(() => {});
    await page.waitForTimeout(wait);
  } finally {
    page.removeListener("response", handler);
  }
  return captured;
}

async function scrapePage(page, route, wait = 6000) {
  await page.goto(SITE + route, { waitUntil: "domcontentloaded", timeout: 35000 }).catch(() => {});
  await page.waitForTimeout(wait);
  return await page.evaluate(() => {
    const out = { url: location.href, tables: [], text: document.body?.innerText?.slice(0,60000) || "", cards: [] };
    document.querySelectorAll("table").forEach(t => {
      const rows = [];
      t.querySelectorAll("tr").forEach(tr => {
        const cells = [...tr.querySelectorAll("th,td")].map(c => (c.innerText || "").trim());
        if (cells.length) rows.push(cells);
      });
      if (rows.length) out.tables.push({ rows });
    });
    const seen = new Set();
    document.querySelectorAll("article, li, [role=button], [class*=card], [class*=Card]").forEach(el => {
      const txt = (el.innerText || "").trim();
      if (txt.length > 4 && txt.length < 400 && !seen.has(txt) && out.cards.length < 80) { seen.add(txt); out.cards.push(txt); }
    });
    return out;
  });
}

async function alunoInfo(page, env, s) {
  const cod = s.codigoAluno || "";
  const aluno = await fetchSed(page, env, s, "GET", "/api/Aluno/ObterAlunoPorCodigo", null, cod ? { codigoAluno: cod } : { ra: s.ra });
  const turmas = cod ? await fetchSed(page, env, s, "GET", "/apihubintegracoes/api/v2/Turma/ListarTurmasPorAluno", null, { codigoAluno: cod }) : null;
  const items = flatten([aluno, turmas]);
  const find = terms => {
    for (const d of items) for (const [k,v] of Object.entries(d)) {
      if (typeof v === "string" && v.trim() && terms.some(t => k.toLowerCase().includes(t))) return v;
    }
    return "";
  };
  return { escola: find(["escola","instituicao","unidade"]), serie: find(["serie","anoescolar","grau"]), turma: find(["turma"]), ano: find(["anoletivo","ano_letivo"]), nome: s.nome || "Aluno", aluno_raw: aluno || null };
}

async function withSession(env, sid, fn) {
  if (!sid) throw new Error("Sessão não informada.");
  const obj = await sessionInfo(env, sid);
  if (!obj) throw new Error("Sessão expirada. Faça login novamente.");
  try { return await fn(obj.page, obj.data); }
  finally { await closeConnection(obj.browser); }
}

async function handleApi(request, env, url) {
  if (request.method !== "POST") return json({ ok:false, error:"Método não permitido" }, 405);
  const body = await request.json().catch(() => ({}));
  const sid = body.session_id;

  if (url.pathname === "/api/login") {
    if (!body.ra || !body.senha) return json({ ok:false, error:"Preencha RA e senha." }, 400);
    try {
      const result = await login(env, body.ra, body.senha);
      return json({ ok:true, data:result });
    } catch (e) {
      return json({ ok:false, error:e?.message || "Falha no login." }, 401);
    }
  }

  if (url.pathname === "/api/logout") {
    if (sid) {
      try { await withSession(env, sid, async (page) => { await page.goto(SITE, {waitUntil:"domcontentloaded", timeout:10000}).catch(()=>{}); }); } catch (_) {}
    }
    return json({ ok:true });
  }

  try {
    return await withSession(env, sid, async (page, s) => {
      if (url.pathname === "/api/heartbeat") return json({ ok:true });
      if (url.pathname === "/api/aluno-info") return json({ ok:true, info:await alunoInfo(page, env, s) });

      if (url.pathname === "/api/boletim") {
        const data = await fetchSed(page, env, s, "POST", "/apiboletim/api/Boletim/GetBoletimCompleto", s.codigoAluno ? null : { ra:s.ra }, s.codigoAluno ? { codigoAluno:s.codigoAluno } : null);
        if (data) return json({ok:true,data,source:"direct"});
        const cap = await capturePage(page, "/boletim", ["GetBoletimCompleto"], 7000);
        const best = pickRealResponse(cap);
        if (best) return json({ok:true,data:best,source:"app"});
        return json({ok:true,data:await scrapePage(page,"/boletim",6000),source:"scrape"});
      }

      if (url.pathname === "/api/frequencia") {
        const data = await fetchSed(page, env, s, "POST", "/apiboletim/api/Frequencia/GetFrequenciaBimestreAtual", s.codigoAluno ? null : {ra:s.ra}, s.codigoAluno ? {codigoAluno:s.codigoAluno} : null);
        if (data) return json({ok:true,data,source:"direct"});
        const cap = await capturePage(page,"/presenca",["GetFrequenciaBimestreAtual","GetFaltasBimestreAtual","ConsultaFrequenciaBimestre"],7000);
        const best = pickRealResponse(cap);
        if (best) return json({ok:true,data:best,source:"app"});
        return json({ok:true,data:await scrapePage(page,"/presenca",6000),source:"scrape"});
      }

      if (url.pathname === "/api/agenda") {
        const data = await fetchSed(page, env, s, "POST", "/apiboletim/api/Agenda/GetAgendaDia", s.codigoAluno ? null : {ra:s.ra}, s.codigoAluno ? {codigoAluno:s.codigoAluno} : null);
        if (data) return json({ok:true,data,source:"direct"});
        const cap = await capturePage(page,"/agenda",["GetAgendaDia","GetAgendaPeriodoEscola"],7000);
        const best = pickRealResponse(cap);
        if (best) return json({ok:true,data:best,source:"app"});
        return json({ok:true,data:await scrapePage(page,"/agenda",6000),source:"scrape"});
      }

      if (url.pathname === "/api/tarefas") {
        const todo = await fetchCmsp(page,s,"GET","/tms/task/todo",null,{expired_only:"false"});
        const count = await fetchCmsp(page,s,"GET","/tms/task/todo/count");
        const cats = await fetchCmsp(page,s,"GET","/tms/category",null,{realm:"edusp"});
        const captured = await capturePage(page,"/tarefas",["/tms/task/"],8000);
        const scraped = await page.evaluate(() => ({url:location.href,tasks:[...document.querySelectorAll("article,li,[role=button],[class*=card],[class*=Card]")].map(x=>(x.innerText||"").trim()).filter(x=>x.length>4&&x.length<400).slice(0,100),text:document.body?.innerText?.slice(0,80000)||""})).catch(()=>null);
        return json({ok:true,data:{tarefasPendentes3:todo,tarefasCount:count,categorias:cats,captured,scraped}});
      }

      if (url.pathname === "/api/materiais") {
        const data = await fetchSed(page,env,s,"GET","/muralavisosapi/api/conteudo-digital/listar-qtde-subcategoria?");
        return json({ok:true,data,repositorio_url:"https://repositorio.educacao.sp.gov.br/Autenticacao?t="+(s.sedToken||s.token||"")});
      }

      if (url.pathname === "/api/resolver-tarefa") {
        const status = body.rascunho ? "draft" : "submitted";
        const cmsp = await fetchCmsp(page,s,"POST","/tms/answer",{task_id:String(body.tarefa_id||""),status,answers:{}},{nick:String(s.ra||"")});
        if (cmsp) return json({ok:true,data:cmsp,source:"cmsp"});
        const endpoint = body.rascunho ? "/apihubintegracoes/api/v2/Tarefa/SalvarResposta" : "/apihubintegracoes/api/v2/Tarefa/FinalizarTarefa";
        const data = await fetchSed(page,env,s,"POST",endpoint,{ra:s.ra,tarefaId:body.tarefa_id,rascunho:!!body.rascunho});
        return json({ok:data!==null,data,source:"bff"});
      }

      if (url.pathname === "/api/robo-data" || url.pathname === "/api/robo-trigger" || url.pathname === "/api/robo-snapshot") {
        if (url.pathname === "/api/robo-data") return json({ok:true,pending:true});
        const pages = [];
        for (const route of ROBO_ROUTES) {
          const info = await scrapePage(page,route,2500).catch(()=>null);
          if (info) pages.push({route,...info});
        }
        if (url.pathname === "/api/robo-trigger") return json({ok:true});
        return json({ok:true,pages});
      }

      if (url.pathname === "/api/debug") {
        return json({ok:true,data:{nome:s.nome,ra:s.ra,token:String(s.token||"").slice(0,50),sed_token:String(s.sedToken||"").slice(0,50),iptv_token:String(s.iptvToken||"").slice(0,50),secure_token:String(s.secureToken||"").slice(0,50),codigo_aluno:s.codigoAluno||""}});
      }

      return json({ok:false,error:"Endpoint não encontrado"},404);
    });
  } catch (e) {
    const msg = e?.message || String(e);
    return json({ok:false,error:msg}, /sessão|sessao/i.test(msg) ? 401 : 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:cors()});
    if (url.pathname === "/api/health") return json({ok:true,browserRun:true,playwright:true});
    if (url.pathname.startsWith("/api/")) return handleApi(request,env,url);
    return new Response("Flash Worker online. Use o index.html como frontend.",{headers:cors({"Content-Type":"text/plain; charset=utf-8"})});
  },
};

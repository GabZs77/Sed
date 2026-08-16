// =======================================================================
// CONFIGURAÇÃO
// Troque pela URL do seu Worker depois de publicá-lo no Cloudflare.
// Ex: "https://sed-proxy.seunome.workers.dev"
// =======================================================================
const WORKER_URL = "https://sdf.gabrielreplit56.workers.dev";

// Chave usada para guardar a sessão no navegador
const STORAGE_KEY = "sed_sessao";

// -------------------------------------------------------------------------
// Elementos da tela
// -------------------------------------------------------------------------
const loginScreen = document.getElementById("login-screen");
const dashboardScreen = document.getElementById("dashboard-screen");
const loginForm = document.getElementById("login-form");
const raInput = document.getElementById("ra-input");
const senhaInput = document.getElementById("senha-input");
const btnEntrar = document.getElementById("btn-entrar");
const loginError = document.getElementById("login-error");

const nomeUsuarioEl = document.getElementById("nome-usuario");
const statTarefasEl = document.getElementById("stat-tarefas");
const statFaltasEl = document.getElementById("stat-faltas");
const statusBlock = document.getElementById("status-block");
const debugBody = document.getElementById("debug-body");
const btnLogout = document.getElementById("btn-logout");

// -------------------------------------------------------------------------
// Sessão (localStorage)
// -------------------------------------------------------------------------
function salvarSessao(sessao) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessao));
}
function lerSessao() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}
function limparSessao() {
  localStorage.removeItem(STORAGE_KEY);
}

// -------------------------------------------------------------------------
// Helpers de UI
// -------------------------------------------------------------------------
function mostrarErroLogin(msg) {
  loginError.textContent = msg;
  loginError.classList.remove("hidden");
}
function esconderErroLogin() {
  loginError.classList.add("hidden");
}
function irParaDashboard() {
  loginScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
}
function irParaLogin() {
  dashboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}
function addStatusLine(texto, tipo) {
  // tipo: "ok" | "err" | "wait"
  const line = document.createElement("div");
  line.className = "status-line";
  line.innerHTML = `<span class="dot ${tipo}"></span> ${texto}`;
  statusBlock.appendChild(line);
}
function limparStatus() {
  statusBlock.innerHTML = "";
}
function addDebug(titulo, dado) {
  const h4 = document.createElement("h4");
  h4.textContent = titulo;

  const texto = typeof dado === "string" ? dado : JSON.stringify(dado, null, 2);

  const btnCopiar = document.createElement("button");
  btnCopiar.textContent = "Copiar";
  btnCopiar.type = "button";
  btnCopiar.style.cssText =
    "margin-left:10px;font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid var(--border);background:var(--card-alt);color:var(--text-dim);cursor:pointer;";
  btnCopiar.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(texto);
      btnCopiar.textContent = "Copiado!";
    } catch {
      btnCopiar.textContent = "Erro ao copiar";
    }
    setTimeout(() => (btnCopiar.textContent = "Copiar"), 1500);
  });
  h4.appendChild(btnCopiar);

  const pre = document.createElement("pre");
  pre.textContent = texto;
  debugBody.appendChild(h4);
  debugBody.appendChild(pre);
}

// -------------------------------------------------------------------------
// Chamadas ao Worker
// -------------------------------------------------------------------------
async function chamarWorker(caminho, { method = "GET", headers = {}, body = null } = {}) {
  const resp = await fetch(`${WORKER_URL}${caminho}`, {
    method,
    headers: body ? { "Content-Type": "application/json", ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  return { ok: resp.ok, status: resp.status, data };
}

// -------------------------------------------------------------------------
// Login
// -------------------------------------------------------------------------
loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  esconderErroLogin();

  const usuario = raInput.value.trim();
  const senha = senhaInput.value;

  if (!usuario || !senha) {
    mostrarErroLogin("Preencha usuário e senha.");
    return;
  }

  btnEntrar.disabled = true;
  btnEntrar.textContent = "Entrando...";

  const { ok, data, status } = await chamarWorker("/login", {
    method: "POST",
    body: { usuario, senha },
  });

  btnEntrar.disabled = false;
  btnEntrar.textContent = "Entrar";

  if (!ok || !data || !data.token2) {
    const msg = data?.erro || `Erro ${status} ao tentar entrar.`;
    const bruto = data?.detalhe ? "\n\nResposta da API:\n" + JSON.stringify(data.detalhe, null, 2) : "";
    mostrarErroLogin(msg + bruto);
    return;
  }

  salvarSessao(data);
  carregarDashboard(data);
});

// -------------------------------------------------------------------------
// Dashboard
// -------------------------------------------------------------------------
async function carregarDashboard(sessao) {
  nomeUsuarioEl.textContent = (sessao.nome || "").split(" ")[0] || sessao.nome || "aluno(a)";
  statTarefasEl.textContent = "…";
  statFaltasEl.textContent = "…";
  limparStatus();
  debugBody.innerHTML = "";
  irParaDashboard();

  addStatusLine("Buscando turmas/salas do aluno...", "wait");

  // 1) Descobre os "publication_target" a partir de /user (opcional — se a
  //    API não exigir, a lista fica vazia e o /todo é chamado sem filtro).
  let targets = [];
  const userResp = await chamarWorker("/user", {
    headers: { "X-Token2": sessao.token2 },
  });
  addDebug("GET /user", userResp.data);
  if (userResp.ok) {
    targets = extrairIdsDeRooms(userResp.data);
    atualizarStatus(0, `Turmas encontradas: ${targets.length}`, "ok");
  } else {
    atualizarStatus(0, "Não foi possível buscar as turmas (seguindo sem filtro).", "err");
  }

  // 2) Tarefas pendentes
  atualizarStatus(1, "Buscando tarefas...", "wait");
  const qs = targets.map((t) => `publication_target=${encodeURIComponent(t)}`).join("&");
  const todoResp = await chamarWorker(`/todo${qs ? "?" + qs : ""}`, {
    headers: { "X-Token2": sessao.token2 },
  });
  addDebug("GET /todo", todoResp.data);

  if (todoResp.ok) {
    const tarefas = extrairArray(todoResp.data);
    const pendentes = contarPendentes(tarefas);
    statTarefasEl.textContent = pendentes;
    atualizarStatus(1, `Tarefas: ${tarefas.length} no total, ${pendentes} pendentes.`, "ok");
  } else {
    statTarefasEl.textContent = "?";
    atualizarStatus(1, "Falha ao buscar tarefas — veja os dados brutos abaixo.", "err");
  }

  // 3) Faltas (via boletim)
  atualizarStatus(2, "Buscando boletim/faltas...", "wait");
  const ano = new Date().getFullYear();
  const boletimResp = await chamarWorker(`/boletim?ano=${ano}`, {
    headers: { "X-Token": sessao.token, "X-Cd-Usuario": sessao.cdUsuarioCurto },
  });
  addDebug("GET /boletim", boletimResp.data);

  if (boletimResp.ok) {
    const faltas = somarPorChave(boletimResp.data, /falta/i);
    statFaltasEl.textContent = faltas ?? "0";
    atualizarStatus(2, faltas !== null ? `Faltas somadas: ${faltas}.` : "Nenhum campo de faltas encontrado na resposta.", faltas !== null ? "ok" : "err");
  } else {
    statFaltasEl.textContent = "?";
    atualizarStatus(2, "Falha ao buscar boletim — veja os dados brutos abaixo.", "err");
  }
}

function atualizarStatus(indice, texto, tipo) {
  // Substitui/adiciona a linha de status na posição "indice"
  const linhas = statusBlock.querySelectorAll(".status-line");
  if (linhas[indice]) {
    linhas[indice].innerHTML = `<span class="dot ${tipo}"></span> ${texto}`;
  } else {
    addStatusLine(texto, tipo);
  }
}

// -------------------------------------------------------------------------
// Extração flexível de dados (a API não é documentada oficialmente —
// estas funções tentam vários formatos comuns de resposta)
// -------------------------------------------------------------------------
function extrairIdsDeRooms(data) {
  const ids = new Set();
  function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      if (("id" in node || "group_id" in node) && (node.name || node.title || node.group_name)) {
        ids.add(node.id ?? node.group_id);
      }
      Object.values(node).forEach(walk);
    }
  }
  walk(data);
  return [...ids].filter(Boolean);
}

function extrairArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const chave of ["tasks", "items", "data", "results", "todo"]) {
    if (Array.isArray(data[chave])) return data[chave];
  }
  for (const v of Object.values(data)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

function contarPendentes(tarefas) {
  if (!Array.isArray(tarefas) || tarefas.length === 0) return 0;
  const concluidos = ["finished", "submitted", "done", "completed", "answered", "corrected"];
  return tarefas.filter((t) => {
    const status = String(t.answer_status ?? t.status ?? "").toLowerCase();
    if (concluidos.includes(status)) return false;
    if (t.answered === true) return false;
    if (t.answer && typeof t.answer === "object") return false;
    return true;
  }).length;
}

function somarPorChave(obj, regexChave) {
  let total = 0;
  let encontrou = false;
  function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (regexChave.test(k) && typeof v === "number") {
          total += v;
          encontrou = true;
        } else if (v && typeof v === "object") {
          walk(v);
        }
      }
    }
  }
  walk(obj);
  return encontrou ? total : null;
}

// -------------------------------------------------------------------------
// Logout
// -------------------------------------------------------------------------
btnLogout.addEventListener("click", () => {
  limparSessao();
  raInput.value = "";
  senhaInput.value = "";
  irParaLogin();
});

// -------------------------------------------------------------------------
// Ao carregar a página: se já houver sessão salva, pula direto pro dashboard
// -------------------------------------------------------------------------
(function init() {
  const sessao = lerSessao();
  if (sessao && sessao.token2) {
    carregarDashboard(sessao);
  }
})();

const WORKER_URL = "https://sdf.gabrielreplit56.workers.dev";
const STORAGE_KEY = "sed_sessao";
const ACCOUNTS_KEY = "sed_contas_salvas";

const $ = (id) => document.getElementById(id);
const loginScreen = $("login-screen");
const dashboardScreen = $("dashboard-screen");
const loginForm = $("login-form");
const loginError = $("login-error");
const btnEntrar = $("btn-entrar");
const senhaInput = $("senha-input");

function sessionSave(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function sessionRead() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; } }
function sessionClear() { localStorage.removeItem(STORAGE_KEY); }

function getSavedAccounts() {
  try {
    const data = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function saveAccount(session) {
  const accounts = getSavedAccounts().filter(a => a.usuario !== session.usuario);
  accounts.unshift({
    usuario: session.usuario,
    nome: session.nome || "Aluno",
    token: session.token || "",
    token2: session.token2 || "",
    iptv_token: session.iptv_token || "",
    secure_token: session.secure_token || "",
    _auth_token: session._auth_token || "",
    apelido: session.apelido || "",
    email: session.email || "",
    cdUsuario: session.cdUsuario || 0,
    cdUsuarioCurto: session.cdUsuarioCurto || "",
    savedAt: Date.now()
  });
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts.slice(0, 10)));
}

function removeSavedAccount(usuario) {
  const accounts = getSavedAccounts().filter(a => a.usuario !== usuario);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function openSavedAccounts() {
  const accounts = getSavedAccounts();
  const root = $("saved-accounts-list");
  if (!root) return;

  if (!accounts.length) {
    root.innerHTML = '<div class="empty">Nenhuma conta salva no momento.</div>';
  } else {
    root.innerHTML = accounts.map((a, i) => `
      <div class="saved-account" data-index="${i}">
        <button class="saved-account-main" type="button">
          <span class="saved-avatar">${esc(initials(a.nome))}</span>
          <span class="saved-info">
            <strong>${esc(a.nome || "Aluno")}</strong>
            <small>${esc(a.usuario || "")}</small>
          </span>
          <span class="saved-arrow">›</span>
        </button>
        <button class="saved-remove" type="button" title="Remover conta">×</button>
      </div>
    `).join("");

    root.querySelectorAll(".saved-account-main").forEach(btn => {
      btn.addEventListener("click", async () => {
        const index = Number(btn.closest(".saved-account").dataset.index);
        const account = getSavedAccounts()[index];
        if (account) await loginWithSavedAccount(account);
      });
    });

    root.querySelectorAll(".saved-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const index = Number(btn.closest(".saved-account").dataset.index);
        const account = getSavedAccounts()[index];
        if (!account) return;
        removeSavedAccount(account.usuario);
        openSavedAccounts();
      });
    });
  }

  $("saved-accounts-modal")?.classList.remove("hidden");
}

function closeSavedAccounts() {
  $("saved-accounts-modal")?.classList.add("hidden");
}

async function loginWithSavedAccount(account) {
  hideLoginError();
  btnEntrar.disabled = true;
  btnEntrar.textContent = "Entrando...";
  closeSavedAccounts();

  try {
    const r = await api("/resume", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token2": account.token2 || "",
        "X-Token": account.token || "",
        "X-Cd-Usuario": account.cdUsuarioCurto || "",
        "X-Task-User": account.apelido || ""
      },
      body: JSON.stringify({ usuario: account.usuario })
    });

    if (!r.ok || !r.data?.ok) {
      throw new Error(r.data?.erro || "A sessão salva expirou. Faça login novamente.");
    }

    const sessao = { ...account, ...r.data };
    sessionSave(sessao);
    await loadDashboard(sessao);
  } catch (err) {
    showLoginError(err.message || "Não foi possível entrar na conta salva.");
  } finally {
    btnEntrar.disabled = false;
    btnEntrar.textContent = "Entrar";
  }
}

async function api(path, options = {}) {
  const resp = await fetch(`${WORKER_URL}${path}`, options);
  let data = null;
  try { data = await resp.json(); } catch {}
  return { ok: resp.ok, status: resp.status, data };
}

function firstName(name) { return String(name || "Aluno").trim().split(/\s+/)[0] || "Aluno"; }
function initials(name) {
  const parts = String(name || "Aluno").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function saudacao() { const h = new Date().getHours(); return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"; }
function esc(v) { const d = document.createElement("div"); d.textContent = String(v ?? ""); return d.innerHTML; }
function dateText(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function weekday(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

function showLoginError(text) { loginError.textContent = text; loginError.classList.remove("hidden"); }
function hideLoginError() { loginError.classList.add("hidden"); }
function goDashboard() { loginScreen.classList.add("hidden"); dashboardScreen.classList.remove("hidden"); }
function goLogin() { dashboardScreen.classList.add("hidden"); loginScreen.classList.remove("hidden"); }

$("btn-eye").addEventListener("click", () => {
  senhaInput.type = senhaInput.type === "password" ? "text" : "password";
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideLoginError();
  const numero = $("ra-numero").value.trim();
  const digito = $("ra-digito").value.trim();
  const uf = $("ra-uf").value.trim().toUpperCase();
  const senha = senhaInput.value;
  if (!numero || !digito || !uf || !senha) {
    showLoginError("Preencha o RA, o dígito, a UF e a senha.");
    return;
  }

  btnEntrar.disabled = true;
  btnEntrar.textContent = "Entrando...";
  try {
    const r = await api("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario: `${numero}${digito}${uf}`, senha })
    });
    if (!r.ok || !r.data?.token2) throw new Error(r.data?.erro || `Erro ${r.status} ao entrar.`);
    const sessao = { ...r.data, usuario: `${numero}${digito}${uf}` };
    sessionSave(sessao);
    saveAccount(sessao);
    await loadDashboard(sessao);
  } catch (err) {
    showLoginError(err.message || "Não foi possível entrar.");
  } finally {
    btnEntrar.disabled = false;
    btnEntrar.textContent = "Entrar";
  }
});

async function loadDashboard(sessao) {
  goDashboard();
  $("admin-nav")?.classList.toggle("hidden", !isAdminSession());
  renderTab("home");
  $("user-name").textContent = `${saudacao()}, ${firstName(sessao.nome)}`;
  $("user-avatar").textContent = initials(sessao.nome);
  $("stat-tasks").textContent = "—";
  $("stat-msg").textContent = "—";
  $("stat-faltas").textContent = "—";
  if ($("faltas-ano-note")) $("faltas-ano-note").textContent = "";
  $("task-badge").textContent = "0";
  $("turma-view").textContent = "Carregando turma...";
  $("tasks-list").innerHTML = '<div class="empty">Carregando tarefas...</div>';

  try {
    const r = await api("/dashboard", {
      headers: {
        "X-Token2": sessao.token2,
        "X-Token": sessao.token || "",
        "X-Cd-Usuario": sessao.cdUsuarioCurto,
        "X-Task-User": sessao.apelido || ""
      }
    });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        sessionClear();
        goLogin();
      }
      throw new Error(r.data?.erro || `Erro ${r.status} ao carregar o painel.`);
    }
    renderDashboard(r.data, sessao);
  } catch (err) {
    $("tasks-list").innerHTML = `<div class="empty">Não foi possível carregar os dados.<br><small>${esc(err.message)}</small></div>`;
    $("turma-view").textContent = "Erro ao carregar turma";
  }
}

function renderDashboard(data, sessao) {
  const tasks = Array.isArray(data.tarefas) ? data.tarefas : [];
  const rooms = Array.isArray(data.turmas) ? data.turmas : [];
  const count = Number(data.pendencias) || tasks.length;
  const faltas = data.faltas == null ? "—" : data.faltas;
  const unread = Number(data.mensagensNaoLidas) || 0;

  $("stat-tasks").textContent = count;
  $("stat-msg").textContent = unread;
  $("msg-badge").textContent = unread;
  $("task-badge").textContent = count;
  $("stat-faltas").textContent = faltas;
  $("faltas-note").textContent = `${faltas} falta${Number(faltas) === 1 ? "" : "s"} no bimestre`;

  const faltasAno = data.faltasAno;
  const presenca = data.presencaPercentual;
  const anoNote = $("faltas-ano-note");
  if (anoNote) {
    anoNote.textContent = (faltasAno != null && presenca != null)
      ? `Você tem: ${faltasAno} falta${Number(faltasAno) === 1 ? "" : "s"} no ano todo, resultando em: ${presenca}% de presença`
      : "";
  }

  if (rooms.length) {
    const r = rooms[0];
    const text = [r.name, r.escola].filter(Boolean).join(" · ");
    $("turma-view").textContent = `Visualizando ${text || "sua turma"}`;
  } else $("turma-view").textContent = "Nenhuma turma encontrada";

  renderTasks(tasks);
}

function renderTasks(tasks) {
  window.currentTasks = tasks || [];
  const root = $("tasks-list");
  if (!tasks.length) { root.innerHTML = '<div class="empty">Nenhuma tarefa pendente encontrada.</div>'; return; }
  root.innerHTML = tasks.map(t => {
    const title = esc(t.title || "Tarefa");
    const meta = [t.subject, t.room, dateText(t.due) ? `Entrega: ${dateText(t.due)}` : ""]
      .filter(Boolean).map(esc).join(" · ");
    return `<div class="task-row"><div class="task-check">✓</div><div><div class="task-title">${title}</div><div class="task-meta">${meta || "Tarefa pendente"}</div></div></div>`;
  }).join("");
}

const NOTIFICATIONS_KEY = "sed_notificacoes";
const ADMIN_RA = "1127241606SP";

function getNotifications() {
  try {
    const data = JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function saveNotifications(items) {
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(items));
}

function isAdminSession() {
  const sessao = sessionRead();
  return String(sessao?.usuario || "").toUpperCase() === ADMIN_RA;
}

function notificationHTML(item, admin = false) {
  return `<article class="notification-item"><div class="notification-item-head"><strong>${esc(item.title)}</strong>${admin ? `<div class="notification-actions"><button type="button" data-notification-edit="${esc(item.id)}">Editar</button><button type="button" data-notification-delete="${esc(item.id)}">Excluir</button></div>` : ""}</div><div>${esc(item.message)}</div><div class="notification-date">${esc(new Date(item.updatedAt || item.createdAt).toLocaleString("pt-BR"))}</div></article>`;
}

function renderNotifications() {
  const items = getNotifications().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const content = items.length ? items.map(item => notificationHTML(item)).join("") : '<div class="empty">Nenhuma notificação publicada.</div>';
  $("notifications-list").innerHTML = content;
  if ($("admin-notification-list")) {
    $("admin-notification-list").innerHTML = items.length ? items.map(item => notificationHTML(item, true)).join("") : '<div class="empty">Nenhuma notificação cadastrada.</div>';
  }
}

function openNotifications() {
  renderNotifications();
  $("notifications-modal").classList.remove("hidden");
}

function resetNotificationForm() {
  $("notification-form")?.reset();
  if ($("notification-id")) $("notification-id").value = "";
}

function renderTab(tab) {
  const allowed = ["home", "ai", "books", "admin"];
  const target = allowed.includes(tab) && (tab !== "admin" || isAdminSession()) ? tab : "home";
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("hidden", panel.id !== `tab-${target}`));
  document.querySelectorAll(".sidebar-tab[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === target));
  if (target === "admin") renderNotifications();
}

document.querySelectorAll(".sidebar-tab[data-tab]").forEach(button => button.addEventListener("click", () => renderTab(button.dataset.tab)));
$("notifications-btn")?.addEventListener("click", openNotifications);
$("close-notifications")?.addEventListener("click", () => $("notifications-modal").classList.add("hidden"));
$("notifications-modal")?.addEventListener("click", e => { if (e.target.id === "notifications-modal") $("notifications-modal").classList.add("hidden"); });
$("notification-form")?.addEventListener("submit", e => {
  e.preventDefault();
  if (!isAdminSession()) return alert("Acesso restrito ao administrador.");
  const title = $("notification-title").value.trim();
  const message = $("notification-message").value.trim();
  if (!title || !message) return;
  const id = $("notification-id").value || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  const items = getNotifications();
  const existing = items.find(item => item.id === id);
  if (existing) { existing.title = title; existing.message = message; existing.updatedAt = now; }
  else items.push({ id, title, message, createdAt: now, updatedAt: now });
  saveNotifications(items);
  resetNotificationForm();
  renderNotifications();
});
$("notification-cancel")?.addEventListener("click", resetNotificationForm);

$("admin-notification-list")?.addEventListener("click", e => {
  const editId = e.target.dataset.notificationEdit;
  const deleteId = e.target.dataset.notificationDelete;
  if (editId) {
    const item = getNotifications().find(entry => entry.id === editId);
    if (!item) return;
    $("notification-id").value = item.id;
    $("notification-title").value = item.title;
    $("notification-message").value = item.message;
    $("notification-title").focus();
  }
  if (deleteId && isAdminSession() && confirm("Excluir esta notificação?")) {
    saveNotifications(getNotifications().filter(item => item.id !== deleteId));
    renderNotifications();
  }
});

$("refresh")?.remove();
renderNotifications();

const PDF_PUBLIC_BASE_URL = "";
const apostilaCatalog = {
  fundamental: [
    { grade: "6º Ano", repoPath: "EF/6ano", books: [{ title: "Matemática / Português", file: "matematica-portugues.pdf" }, { title: "Geografia / História", file: "geografia-historia.pdf" }, { title: "Ciências / Inglês / Projeto de Vida", file: "ciencias-ingles-projeto-de-vida.pdf" }] },
    { grade: "7º Ano", repoPath: "EF/7ano", books: [{ title: "Ciências / Inglês / Projeto de Vida", file: "ciencias-ingles-projeto-de-vida.pdf" }, { title: "Geografia / História", file: "geografia-historia.pdf" }, { title: "Matemática / Português", file: "matematica-portugues.pdf" }] },
    { grade: "8º Ano", repoPath: "EF/8ano", books: [{ title: "Ciências / Inglês / Projeto de Vida", file: "ciencias-ingles-projeto-de-vida.pdf" }, { title: "Geografia / História", file: "geografia-historia.pdf" }, { title: "Matemática / Português", file: "matematica-portugues.pdf" }] },
    { grade: "9º Ano", repoPath: "EF/9ano", books: [{ title: "Ciências / Inglês / Projeto de Vida", file: "ciencias-ingles-projeto-de-vida.pdf" }, { title: "Geografia / História", file: "geografia-historia.pdf" }, { title: "Português / Matemática", file: "portugues-matematica.pdf" }] }
  ],
  medio: [
    { grade: "1º Ano", repoPath: "EM/1ano", books: [{ title: "Biologia / Física / Química", file: "biologia-fisica-quimica.pdf" }, { title: "História / Geografia / Inglês", file: "historia-geografia-ingles.pdf" }, { title: "Português / Matemática", file: "portugues-matematica.pdf" }] },
    { grade: "2º Ano", repoPath: "EM/2ano", books: [{ title: "Biologia / Física / Química", file: "biologia-fisica-quimica.pdf" }, { title: "História / Geografia / Inglês", file: "historia-geografia-ingles.pdf" }, { title: "Português / Matemática", file: "portugues-matematica.pdf" }] },
    { grade: "3º Ano", repoPath: "EM/3ano", books: [{ title: "História / Física / Inglês", file: "historia-fisica-ingles.pdf" }, { title: "Português / Matemática", file: "portugues-matematica.pdf" }] }
  ]
};
function apostilaUrl(repoPath, file) { const path = `${repoPath}/${file}`; return PDF_PUBLIC_BASE_URL ? `${PDF_PUBLIC_BASE_URL.replace(/\/$/, "")}/${path}` : `./${path}`; }
function renderBooksPanel(type) { const root = $(`books-${type}`); if (!root) return; root.innerHTML = apostilaCatalog[type].map(year => `<article class="grade-card"><div class="grade-head"><div class="grade-number">${year.grade.match(/\d+/)?.[0] || ""}</div><div><div class="grade-title">${year.grade}</div><div class="grade-count">${year.books.length} apostilas disponíveis</div></div></div><div class="apostila-list">${year.books.map(book => `<button class="apostila-item" type="button" data-pdf-url="${esc(apostilaUrl(year.repoPath, book.file))}" data-pdf-title="${esc(`${year.grade} · ${book.title}`)}"><span class="apostila-icon">PDF</span><span>${esc(book.title)}</span><span class="apostila-open">↗</span></button>`).join("")}</div></article>`).join(""); }
renderBooksPanel("fundamental"); renderBooksPanel("medio");
document.querySelectorAll(".books-tab").forEach(button => button.addEventListener("click", () => { const target = button.dataset.booksTab; document.querySelectorAll(".books-tab").forEach(item => item.classList.toggle("active", item === button)); document.querySelectorAll(".books-panel").forEach(panel => panel.classList.toggle("hidden", panel.id !== `books-${target}`)); }));
let pdfDocument = null; let pdfPageNumber = 1; let pdfRenderTask = null;
async function renderPdfPage(pageNumber) { if (!pdfDocument) return; pdfPageNumber = Math.max(1, Math.min(Number(pageNumber) || 1, pdfDocument.numPages)); const page = await pdfDocument.getPage(pdfPageNumber); const stage = $("pdf-stage"); const baseViewport = page.getViewport({ scale: 1 }); const scale = Math.min(1.65, Math.max(.75, (stage.clientWidth - 30) / baseViewport.width)); const viewport = page.getViewport({ scale }); const canvas = $("pdf-canvas"); canvas.width = viewport.width; canvas.height = viewport.height; if (pdfRenderTask) pdfRenderTask.cancel(); pdfRenderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport }); await pdfRenderTask.promise.catch(() => {}); $("pdf-page").value = pdfPageNumber; $("pdf-total").textContent = `/ ${pdfDocument.numPages}`; $("pdf-status").textContent = `Página ${pdfPageNumber} de ${pdfDocument.numPages}`; }
async function openPdfReader(url, title) { $("pdf-title").textContent = title; $("pdf-modal").classList.remove("hidden"); $("pdf-status").textContent = "Carregando PDF..."; try { pdfDocument = await window.pdfjsLib.getDocument(url).promise; pdfPageNumber = 1; await renderPdfPage(1); } catch { $("pdf-status").textContent = "Não foi possível abrir este PDF. Verifique o arquivo e o CORS do R2."; } }
document.addEventListener("click", event => { const book = event.target.closest(".apostila-item"); if (book) openPdfReader(book.dataset.pdfUrl, book.dataset.pdfTitle); });
$("pdf-prev")?.addEventListener("click", () => renderPdfPage(pdfPageNumber - 1)); $("pdf-next")?.addEventListener("click", () => renderPdfPage(pdfPageNumber + 1)); $("pdf-page")?.addEventListener("change", event => renderPdfPage(event.target.value)); $("close-pdf")?.addEventListener("click", () => { $("pdf-modal").classList.add("hidden"); if (pdfRenderTask) pdfRenderTask.cancel(); pdfDocument = null; }); $("pdf-modal")?.addEventListener("click", event => { if (event.target.id === "pdf-modal") $("close-pdf").click(); }); window.addEventListener("resize", () => { if (pdfDocument && !$("pdf-modal").classList.contains("hidden")) renderPdfPage(pdfPageNumber); });
$("logout").addEventListener("click", () => { sessionClear(); senhaInput.value = ""; goLogin(); });

// =======================================================
// LÓGICA DA ABA E MODAL DE RESPOSTAS (TAREFA SP)
// =======================================================

$("btn-tarefa-sp").addEventListener("click", () => {
  const list = $("tarefas-modal-list");
  const tasks = window.currentTasks || [];

  if (!tasks.length) {
    list.innerHTML = '<div class="empty">Nenhuma tarefa pendente encontrada.</div>';
  } else {
    list.innerHTML = tasks.map(t => {
      const title = esc(t.title || "Tarefa");
      const meta = [t.subject, t.room, dateText(t.due) ? `Entrega: ${dateText(t.due)}` : ""]
        .filter(Boolean).map(esc).join(" · ");
      const taskId = extractTaskIdFromTask(t);
      const raw = t.raw || {};
      const roomName = raw.room_name || raw.room || t.room || "";
      return `
        <div class="task-modal-item">
          <div class="task-title">${title}</div>
          <div class="task-meta">${meta || "Tarefa pendente"}</div>
          <button class="btn-show-answer" data-task-id="${taskId}" data-room-name="${esc(roomName)}">Responder Atividade</button>
        </div>
      `;
    }).join("");
  }
  $("tarefa-sp-aba").classList.remove("hidden");
});

$("close-tarefa-aba").addEventListener("click", () => {
  $("tarefa-sp-aba").classList.add("hidden");
});

let captchaState = {
  challengeId: "",
  image: "",
  token: localStorage.getItem("edusp_captcha_token") || ""
};

function captchaCardHTML() {
  return `
    <div id="captcha-card" class="captcha-card">
      <div class="captcha-head">
        <div class="captcha-icon">🔑</div>
        <div class="captcha-head-text">
          <div class="captcha-title-row">
            <strong>Verificação CAPTCHA SED / EduSP</strong>
            <span id="captcha-status" class="captcha-badge">⚠ Requer Validação</span>
          </div>
          <p id="captcha-help">Clique no botão para carregar a imagem do CAPTCHA e digitar o código.</p>
        </div>
        <button id="captcha-hide" class="captcha-link" type="button">Ocultar</button>
      </div>
      <div id="captcha-body" class="captcha-body">
        <button id="captcha-load" class="btn captcha-load" type="button">🔑 Exibir CAPTCHA</button>
      </div>
    </div>`;
}

function mountCaptchaCard() {
  const content = $("resposta-content");
  if (!content) return;
  let card = $("captcha-card");
  if (!card) {
    content.insertAdjacentHTML("beforebegin", captchaCardHTML());
    card = $("captcha-card");
  }
  card.classList.remove("hidden");
  $("captcha-hide")?.addEventListener("click", () => card.classList.add("hidden"));
  $("captcha-load")?.addEventListener("click", loadCaptcha);
  if (captchaState.token) setCaptchaVerified();
}

async function loadCaptcha() {
  const sessao = sessionRead();
  if (!sessao?.token2) throw new Error("Sessão expirada. Faça login novamente.");

  const body = { realm: "edusp", type: "image" };
  $("captcha-body").innerHTML = '<div class="captcha-loading">↻ Carregando imagem do CAPTCHA...</div>';

  const r = await api("/captcha/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Token2": sessao.token2 },
    body: JSON.stringify(body)
  });

  if (!r.ok) throw new Error(r.data?.erro || "Falha ao carregar o CAPTCHA.");

  captchaState.challengeId = r.data?.challengeId || r.data?.challenge_id || r.data?.id || "";
  captchaState.image = r.data?.image || r.data?.challenge?.image || "";

  if (!captchaState.challengeId || !captchaState.image) throw new Error("O servidor não retornou uma imagem de CAPTCHA válida.");

  renderCaptchaChallenge();
}

function renderCaptchaChallenge() {
  $("captcha-body").innerHTML = `
    <div class="captcha-box">
      <div class="captcha-image-wrap">
        <img src="data:image/png;base64,${captchaState.image}" alt="Desafio CAPTCHA" class="captcha-image">
        <button id="captcha-refresh" class="captcha-refresh" type="button" title="Trocar imagem">↻</button>
      </div>
      <div class="captcha-input-area">
        <label>Código da Imagem:</label>
        <div class="captcha-input-row">
          <input id="captcha-answer" class="captcha-input" maxlength="10" autocomplete="off" placeholder="Ex: AB4PF">
          <button id="captcha-verify" class="btn captcha-verify" type="button">↻ Verificar</button>
        </div>
      </div>
    </div>
    <div id="captcha-message" class="captcha-message hidden"></div>`;

  $("captcha-refresh").addEventListener("click", async () => {
    try { await loadCaptcha(); } catch (e) { showCaptchaMessage(e.message, true); }
  });
  $("captcha-answer").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });
  $("captcha-verify").addEventListener("click", verifyCaptcha);
}

function showCaptchaMessage(text, error = false) {
  const el = $("captcha-message");
  if (!el) return;
  el.textContent = text;
  el.className = `captcha-message ${error ? "captcha-error" : "captcha-success"}`;
}

function setCaptchaVerified() {
  const badge = $("captcha-status");
  const help = $("captcha-help");
  if (badge) { badge.textContent = "✓ CAPTCHA Ativo"; badge.classList.add("verified"); }
  if (help) help.textContent = "Seu token de CAPTCHA está salvo e pronto para consultar o enunciado.";
}

function setCaptchaPending() {
  const badge = $("captcha-status");
  const help = $("captcha-help");
  if (badge) { badge.textContent = "⚠ Requer Validação"; badge.classList.remove("verified"); }
  if (help) help.textContent = "Gere uma nova imagem e valide o CAPTCHA para consultar o enunciado.";
  if ($("captcha-body")) {
    $("captcha-body").innerHTML = '<button id="captcha-load" class="btn captcha-load" type="button">🔑 Exibir CAPTCHA</button>';
    $("captcha-load").addEventListener("click", loadCaptcha);
  }
}

async function verifyCaptcha() {
  const sessao = sessionRead();
  const answer = $("captcha-answer")?.value.trim().toUpperCase();
  if (!answer) return showCaptchaMessage("Digite o código da imagem.", true);

  const btn = $("captcha-verify");
  btn.disabled = true;
  btn.textContent = "↻ Verificando...";

  try {
    const r = await api("/captcha/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token2": sessao.token2 },
      body: JSON.stringify({
        type: "image",
        realm: "edusp",
        payload: { challengeId: captchaState.challengeId, answer }
      })
    });

    const token = r.data?.token || r.data?.captcha_token || r.data?.captchaToken || "";
    if (!r.ok || (!token && !r.data?.valid)) {
      await loadCaptcha();
      throw new Error(r.data?.erro || r.data?.message || "Código incorreto. Tente novamente.");
    }

    captchaState.token = token || "verified";
    localStorage.setItem("edusp_captcha_token", captchaState.token);
    setCaptchaVerified();
    showCaptchaMessage("✓ CAPTCHA verificado com sucesso!", false);
    await loadTaskQuestions();
  } catch (err) {
    showCaptchaMessage(err.message || "Falha ao validar CAPTCHA.", true);
  } finally {
    if ($("captcha-verify")) {
      $("captcha-verify").disabled = false;
      $("captcha-verify").textContent = "↻ Verificar";
    }
  }
}

function extractTaskIdFromTask(task) {
  if (!task) return "";
  const preferred = [
    "id", "task_id", "taskId", "tarefa_id", "tarefaId",
    "assignment_id", "assignmentId", "activity_id", "activityId",
    "atividade_id", "atividadeId", "id_tarefa", "idTarefa"
  ];

  for (const key of preferred) {
    if (task[key] !== undefined && task[key] !== null && String(task[key]).trim() !== "") {
      return String(task[key]).trim();
    }
  }

  const nested = ["raw", "task", "tarefa", "activity", "atividade", "assignment", "data", "attributes"];
  for (const key of nested) {
    const value = task[key];
    if (value && typeof value === "object") {
      const found = extractTaskIdFromTask(value);
      if (found) return found;
    }
  }

  return "";
}

let pendingTask = null;
let activityTimerId = null;
let activityDeadlineAt = 0;
const ACTIVITY_TIME_LIMIT_SECONDS = 9 * 60;

function stopActivityTimer() {
  if (activityTimerId) clearInterval(activityTimerId);
  activityTimerId = null;
}

function formatActivityTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function startActivityTimer() {
  stopActivityTimer();
  const deadline = $("activity-deadline");
  const timer = $("activity-timer");
  if (!deadline || !timer) return;
  activityDeadlineAt = Date.now() + ACTIVITY_TIME_LIMIT_SECONDS * 1000;
  deadline.classList.remove("hidden", "expired");
  timer.textContent = formatActivityTime(ACTIVITY_TIME_LIMIT_SECONDS);
  activityTimerId = setInterval(() => {
    const remaining = Math.ceil((activityDeadlineAt - Date.now()) / 1000);
    timer.textContent = formatActivityTime(remaining);
    if (remaining <= 60) deadline.classList.add("expired");
    if (remaining <= 0) {
      stopActivityTimer();
      const submitButton = $("btn-enviar-respostas");
      if (submitButton && submitButton.style.display !== "none") {
        submitButton.click();
      } else {
        $("resposta-content").insertAdjacentHTML("afterbegin", '<p class="error">O prazo de 9 minutos terminou. Não há respostas preenchidas para enviar.</p>');
      }
    }
  }, 1000);
}

async function loadTaskQuestions() {
  if (!pendingTask) return;
  const { taskId, roomName } = pendingTask;
  const sessao = sessionRead();
  if (!taskId) {
    $("resposta-content").innerHTML = "<p>Erro: a API de tarefas não forneceu o ID desta atividade.</p>";
    return;
  }
  $("resposta-content").textContent = "Carregando atividade para resposta...";

  try {
    const r = await api(`/task-details?task_id=${encodeURIComponent(taskId)}&room_name=${encodeURIComponent(roomName)}`, {
      headers: {
        "X-Token2": sessao.token2,
        "X-IPTV-Token": sessao.iptv_token || "",
        "X-Secure-Token": sessao.secure_token || "",
        "X-Auth-Token": sessao._auth_token || "",
        "X-Captcha-Token": captchaState.token,
      }
    });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403 || r.data?.captcha_required) {
        captchaState.token = "";
        captchaState.challengeId = "";
        localStorage.removeItem("edusp_captcha_token");
        setCaptchaPending();
        throw new Error("A SED recusou o token do CAPTCHA para esta atividade. Gere uma nova imagem e valide novamente.");
      }
      throw new Error(r.data?.erro || `Erro ${r.status} ao buscar a atividade`);
    }

    const data = r.data || {};
    $("resposta-titulo").textContent = data.title || data.name || data.titulo || "Atividade";
    let questions = Array.isArray(data.questions) ? data.questions :
      Array.isArray(data.items) ? data.items :
      Array.isArray(data.questoes) ? data.questoes :
      Array.isArray(data.data) ? data.data :
      Array.isArray(data?.task?.questions) ? data.task.questions : [];

    if (!questions.length) {
      $("resposta-content").innerHTML = "<p>Nenhuma questão encontrada para esta atividade.</p>";
      $("btn-enviar-respostas").style.display = "none";
      return;
    }

    window.currentQuestions = questions;
    window.currentTaskId = taskId;
    window.currentRoomName = roomName;
    $("resposta-content").innerHTML = questions.map((q, i) => {
      const qId = q.id || q.question_id || q.codigo || `q${i}`;
      const qText = q.enunciado || q.texto || q.question || q.text || `Questão ${i + 1}`;
      const options = q.alternativas || q.options || q.opcoes || [];
      let out = `<div class="questao" data-question-id="${esc(qId)}"><p>${i + 1}. ${esc(qText)}</p>`;
      if (options.length) {
        out += `<select class="answer-input"><option value="">Selecione...</option>`;
        options.forEach((opt, j) => out += `<option value="${esc(opt.id ?? opt.codigo ?? j)}">${esc(opt.texto || opt.text || opt.enunciado || opt.label || `Alternativa ${j + 1}`)}</option>`);
        out += `</select>`;
      } else out += `<input type="text" class="answer-input" placeholder="Digite sua resposta">`;
      return out + `</div>`;
    }).join("");
    $("btn-enviar-respostas").style.display = "block";
  } catch (err) {
    $("resposta-content").innerHTML = `<p>Erro: ${esc(err.message)}</p>`;
    $("btn-enviar-respostas").style.display = "none";
  }
}

document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("btn-show-answer")) {
    const taskId = e.target.dataset.taskId || "";
    const roomName = e.target.dataset.roomName || "";
    const sessao = sessionRead();

    if (!taskId) {
      $("resposta-content").textContent = "Erro: esta tarefa não possui um identificador válido.";
      $("resposta-modal").classList.remove("hidden");
      return;
    }
    if (!sessao?.token2) {
      $("resposta-content").textContent = "Erro: sessão expirada. Faça login novamente.";
      $("resposta-modal").classList.remove("hidden");
      return;
    }

    pendingTask = { taskId, roomName };
    $("resposta-modal").classList.remove("hidden");
    $("btn-enviar-respostas").style.display = "none";
    startActivityTimer();
    $("resposta-content").innerHTML = '<p>Valide o CAPTCHA para carregar e responder a atividade.</p>';
    mountCaptchaCard();

    if (captchaState.token) {
      setCaptchaVerified();
      await loadTaskQuestions();
    }
  }
});

$("close-resposta-modal").addEventListener("click", () => {
  stopActivityTimer();
  $("resposta-modal").classList.add("hidden");
});

$("btn-enviar-respostas").addEventListener("click", async () => {
  const sessao = sessionRead();
  if (!sessao?.token2) {
    alert("Sessão expirada. Faça login novamente.");
    return;
  }

  const questions = window.currentQuestions || [];
  const taskId = window.currentTaskId;
  const roomName = window.currentRoomName;
  if (!taskId) {
    alert("Tarefa não identificada.");
    return;
  }

  const answers = [];
  document.querySelectorAll(".questao").forEach((el) => {
    const qId = el.dataset.questionId;
    const input = el.querySelector(".answer-input");
    const value = input?.value?.trim() || "";
    if (qId && value !== "") {
      answers.push({ question_id: qId, answer: value });
    }
  });

  if (!answers.length) {
    alert("Nenhuma resposta preenchida.");
    return;
  }

  $("btn-enviar-respostas").disabled = true;
  $("btn-enviar-respostas").textContent = "Enviando...";

  try {
    const r = await api(`/answer-task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Token2": sessao.token2,
        "X-Captcha-Token": captchaState.token || "",
      },
      body: JSON.stringify({
        task_id: taskId,
        room_name: roomName,
        answers,
        captcha_token: captchaState.token || ""
      })
    });

    if (!r.ok) throw new Error(r.data?.erro || `Erro ${r.status} ao enviar respostas`);

    stopActivityTimer();
    alert("Respostas enviadas com sucesso!");
    $("resposta-modal").classList.add("hidden");
    loadDashboard(sessao);
  } catch (err) {
    alert("Erro ao enviar respostas: " + err.message);
  } finally {
    $("btn-enviar-respostas").disabled = false;
    $("btn-enviar-respostas").textContent = "Enviar Respostas";
  }
});


$("btn-contas-salvas")?.addEventListener("click", openSavedAccounts);
$("close-saved-accounts")?.addEventListener("click", closeSavedAccounts);
$("saved-accounts-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "saved-accounts-modal") closeSavedAccounts();
});

// Inicialização: se já houver sessão salva, carrega o dashboard
const saved = sessionRead();
if (saved?.token2) loadDashboard(saved);

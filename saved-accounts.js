/* Contas salvas neste navegador. Reutiliza as sessões já emitidas pelo SED; nunca armazena senhas. */
(function () {
  "use strict";
  var SESSION_KEY = "sed_sessao";
  var ACCOUNTS_KEY = "sed_contas_salvas";
  var MAX_ACCOUNTS = 20;
  var nativeSetItem = Storage.prototype.setItem;

  function readAccounts() {
    try {
      var parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(function (item) {
        return item && typeof item.usuario === "string" && (item.token || item.token2);
      }) : [];
    } catch (_) { return []; }
  }

  function remember(session) {
    if (!session || typeof session.usuario !== "string" || !(session.token || session.token2)) return;
    var accounts = readAccounts();
    var account = Object.assign({}, session, {
      nome: session.nome || session.nomeCompleto || session.name || session.apelido || session.usuario
    });
    ["senha", "password", "credentials", "refreshPassword"].forEach(function (key) { delete account[key]; });
    accounts = accounts.filter(function (item) { return item.usuario !== account.usuario; });
    accounts.unshift(account);
    try { nativeSetItem.call(localStorage, ACCOUNTS_KEY, JSON.stringify(accounts.slice(0, MAX_ACCOUNTS))); }
    catch (_) { /* armazenamento cheio ou desativado: o login normal continua funcionando */ }
  }

  // O login da aplicação grava a sessão aqui. Interceptamos somente a chave da sessão
  // existente e fazemos a cópia local necessária para permitir a troca entre contas.
  Storage.prototype.setItem = function (key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && key === SESSION_KEY) {
      try { remember(JSON.parse(value)); } catch (_) { /* sessão inválida */ }
    }
  };

  // Migra a sessão atual quando a pessoa já estava conectada antes da atualização.
  try { remember(JSON.parse(localStorage.getItem(SESSION_KEY) || "null")); } catch (_) { /* noop */ }

  var style = document.createElement("style");
  style.textContent = [
    ".saved-accounts-trigger{width:100%;min-height:48px;margin-top:12px;padding:0 16px;border:1px solid #ffffff25;border-radius:14px;background:#ffffff0a;color:#e5e7eb;font-family:inherit;font-size:14px;font-weight:600;line-height:1.2;cursor:pointer;transition:background .2s,border-color .2s,transform .2s}",
    ".saved-accounts-trigger:hover{background:#ffffff14;border-color:#ffffff55;transform:translateY(-1px)}",
    ".saved-accounts-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:#030407c9;backdrop-filter:blur(10px);animation:saved-fade .18s ease both}",
    ".saved-accounts-dialog{width:min(100%,600px);max-height:min(88vh,760px);overflow:auto;padding:clamp(22px,5vw,44px);border:1px solid #ffffff20;border-radius:28px;background:#111820;color:#f4f5f7;box-shadow:0 30px 100px #000a;animation:saved-rise .24s cubic-bezier(.2,.8,.2,1) both}",
    ".saved-accounts-dialog h2{margin:0;font-size:clamp(24px,5vw,34px);font-weight:500;letter-spacing:-.03em}",
    ".saved-accounts-dialog p{margin:10px 0 24px;color:#aeb4be;font-size:clamp(14px,3vw,18px);line-height:1.5}",
    ".saved-accounts-list{display:grid;gap:12px}",
    ".saved-account-row{display:flex;align-items:center;gap:12px;min-height:82px;padding:12px 14px 12px 20px;border:1px solid #ffffff20;border-radius:20px;background:#1b222b;transition:background .2s,border-color .2s,transform .2s}",
    ".saved-account-row:hover{border-color:#ffffff55;background:#242a33;transform:translateY(-1px)}",
    ".saved-account-select{flex:1;min-width:0;padding:5px 0;text-align:left;color:inherit;background:none;border:0;cursor:pointer}",
    ".saved-account-code{display:block;overflow:hidden;color:#f3f4f6;font-size:clamp(16px,3.5vw,21px);font-weight:700;text-overflow:ellipsis;white-space:nowrap}",
    ".saved-account-name{display:block;margin-top:4px;overflow:hidden;color:#a9adb5;font-size:clamp(14px,3vw,17px);text-overflow:ellipsis;white-space:nowrap}",
    ".saved-account-remove{flex:none;width:42px;height:42px;border:0;border-radius:50%;background:transparent;color:#9ca3af;font-size:24px;cursor:pointer}",
    ".saved-account-remove:hover{background:#ffffff12;color:white}",
    ".saved-accounts-empty{padding:18px;border:1px dashed #ffffff30;border-radius:18px;color:#c2c5cc;text-align:center}",
    ".saved-accounts-close{width:100%;min-height:60px;margin-top:22px;border:0;border-radius:18px;background:#2b3038;color:#fff;font-size:18px;font-weight:700;cursor:pointer;transition:background .2s,transform .2s}",
    ".saved-accounts-close:hover{background:#3a404a;transform:translateY(-1px)}",
    "@keyframes saved-fade{from{opacity:0}to{opacity:1}}@keyframes saved-rise{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}",
    "@media(prefers-reduced-motion:reduce){.saved-accounts-backdrop,.saved-accounts-dialog{animation:none}.saved-account-row,.saved-accounts-close,.saved-accounts-trigger{transition:none}}",
    "@media(max-width:480px){.saved-accounts-backdrop{padding:12px}.saved-accounts-dialog{border-radius:22px;padding:22px 18px}.saved-account-row{min-height:72px;padding-left:14px}}"
  ].join("");
  document.head.appendChild(style);

  function escapeKey(event) {
    if (event.key === "Escape") closeDialog();
  }
  function closeDialog() {
    var backdrop = document.querySelector(".saved-accounts-backdrop");
    if (backdrop) backdrop.remove();
    document.removeEventListener("keydown", escapeKey);
  }
  function openDialog() {
    closeDialog();
    var backdrop = document.createElement("div");
    backdrop.className = "saved-accounts-backdrop";
    backdrop.addEventListener("click", function (event) { if (event.target === backdrop) closeDialog(); });
    var dialog = document.createElement("section");
    dialog.className = "saved-accounts-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "saved-accounts-title");
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", escapeKey);
    renderDialog(dialog);
  }
  function renderDialog(dialog) {
    dialog.replaceChildren();
    var title = document.createElement("h2");
    title.id = "saved-accounts-title";
    title.textContent = "Contas Salvas";
    var description = document.createElement("p");
    description.textContent = "Toque em uma conta para entrar automaticamente.";
    var list = document.createElement("div");
    list.className = "saved-accounts-list";
    readAccounts().forEach(function (account) {
      var row = document.createElement("div");
      row.className = "saved-account-row";
      var select = document.createElement("button");
      select.type = "button";
      select.className = "saved-account-select";
      var code = document.createElement("span");
      code.className = "saved-account-code";
      code.textContent = account.usuario;
      var name = document.createElement("span");
      name.className = "saved-account-name";
      name.textContent = account.nome || account.nomeCompleto || account.name || account.apelido || "Conta salva";
      select.append(code, name);
      select.addEventListener("click", function () {
        try {
          nativeSetItem.call(localStorage, SESSION_KEY, JSON.stringify(account));
          closeDialog();
          window.location.reload();
        } catch (_) {
          description.textContent = "Não foi possível acessar o armazenamento local. Verifique as permissões do navegador.";
        }
      });
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "saved-account-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remover a conta " + (account.nome || account.usuario) + " das contas salvas");
      remove.addEventListener("click", function () {
        var remaining = readAccounts().filter(function (item) { return item.usuario !== account.usuario; });
        try { nativeSetItem.call(localStorage, ACCOUNTS_KEY, JSON.stringify(remaining)); }
        catch (_) { /* noop */ }
        renderDialog(dialog);
      });
      row.append(select, remove);
      list.appendChild(row);
    });
    if (!list.childElementCount) {
      var empty = document.createElement("div");
      empty.className = "saved-accounts-empty";
      empty.textContent = "As contas usadas neste navegador aparecerão aqui após o próximo login.";
      list.appendChild(empty);
    }
    var close = document.createElement("button");
    close.type = "button";
    close.className = "saved-accounts-close";
    close.textContent = "Fechar";
    close.addEventListener("click", closeDialog);
    dialog.append(title, description, list, close);
    close.focus();
  }

  function addButton() {
    var form = document.querySelector(".login-form");
    if (!form || form.querySelector(".saved-accounts-trigger")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "saved-accounts-trigger";
    button.textContent = "Contas Salvas (" + readAccounts().length + ")";
    button.addEventListener("click", openDialog);
    var submit = form.querySelector('button[type="submit"]');
    if (submit) submit.insertAdjacentElement("afterend", button);
    else form.appendChild(button);
  }

  var observer = new MutationObserver(addButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();

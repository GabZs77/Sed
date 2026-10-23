/* Aviso de sessão da Secretaria expirada.
   Agenda, Boletim e Presença usam o token da Secretaria (SED), que expira antes do token
   das tarefas. Quando ele expira, mostramos um aviso com o botão para entrar novamente. */
(function () {
  "use strict";
  var SESSION_KEY = "sed_sessao";
  var ACADEMIC = /^\/(agenda|boletim|presenca)(\/|$)/;
  var shown = false;

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (_) { return null; }
  }
  function tokenExpired(token) {
    try {
      var part = String(token || "").split(".")[1];
      if (!part) return false;
      var json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      return typeof json.exp === "number" && json.exp * 1000 < Date.now();
    } catch (_) { return false; }
  }

  var style = document.createElement("style");
  style.textContent = [
    ".sed-expired{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9000;width:min(92vw,520px);padding:16px 18px;border:1px solid #f59e0b66;border-radius:18px;background:#141b24f2;color:#f4f5f7;box-shadow:0 18px 60px #000a;backdrop-filter:blur(10px);font-family:inherit;display:flex;gap:14px;align-items:center}",
    ".sed-expired p{margin:0;font-size:14px;line-height:1.4;flex:1}",
    ".sed-expired strong{display:block;color:#fbbf24;margin-bottom:2px}",
    ".sed-expired button{border:0;border-radius:12px;padding:10px 14px;background:#f59e0b;color:#111;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap}"
  ].join("");
  document.head.appendChild(style);

  function relogin() {
    localStorage.removeItem(SESSION_KEY);
    location.href = "/";
  }
  function show() {
    if (shown || !ACADEMIC.test(location.pathname)) return;
    shown = true;
    var box = document.createElement("div");
    box.className = "sed-expired";
    box.setAttribute("role", "alert");
    box.innerHTML = '<p><strong>Sessão da Secretaria expirada</strong>Para ver Agenda, Boletim e Presença, entre novamente com seu RA e senha.</p><button type="button">Entrar novamente</button>';
    box.querySelector("button").addEventListener("click", relogin);
    document.body.appendChild(box);
  }
  function hide() {
    var box = document.querySelector(".sed-expired");
    if (box) box.remove();
    shown = false;
  }
  function check() {
    if (!ACADEMIC.test(location.pathname)) return hide();
    var session = readSession();
    if (session && session.token && tokenExpired(session.token)) show();
  }

  window.addEventListener("sedx:sed-expired", function () { window.__sedxSedExpired = true; show(); });
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(function () { hide(); if (window.__sedxSedExpired) show(); check(); }, 0);
      return result;
    };
  });
  window.addEventListener("popstate", function () { hide(); if (window.__sedxSedExpired) show(); check(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check); else check();
})();

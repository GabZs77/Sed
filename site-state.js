(() => {
  'use strict';
  const WORKER_URL = 'https://sdf.gabrielreplit56.workers.dev';
  const ADMIN_RAS = new Set(['1127620514', '1127241606']);
  const THEMES = new Set(['default', 'halloween', 'christmas', 'kids']);
  const THEME_STORAGE = 'sedx_active_theme';
  let activeTheme = 'default';

  const session = () => { try { return JSON.parse(localStorage.getItem('sed_sessao') || 'null'); } catch { return null; } };
  const isAdmin = () => ADMIN_RAS.has(String(session()?.usuario || '').replace(/\D/g, ''));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  const notificationReadKey = () => `sedx_read_notifications_${String(session()?.usuario || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const readNotificationIds = () => { try { const value = JSON.parse(localStorage.getItem(notificationReadKey()) || '[]'); return new Set(Array.isArray(value) ? value.map(String) : []); } catch { return new Set(); } };
  const markNotificationsRead = (notices) => { try { localStorage.setItem(notificationReadKey(), JSON.stringify(notices.map((notice, index) => String(notice.id || notice.publishedAt || index)))); } catch {} };
  const notificationId = (notice, index) => String(notice.id || notice.publishedAt || index);
  const request = async (path) => { const response = await fetch(`${WORKER_URL}${path}`, { cache: 'no-store' }); return response.json(); };

  function makeParticles(theme) {
    const existing = document.querySelector('[data-sedx-theme-particles]');
    if (theme === 'default') { existing?.remove(); return; }
    if (activeTheme === theme && existing) return;
    existing?.remove();
    const symbols = {
      halloween: ['✦', '🦇', '·', '✧', '🍂', '✦', '🦇'],
      christmas: ['❄', '❅', '✦', '❄', '✧', '❆', '❄'],
      kids: ['✦', '🍬', '·', '🍭', '✧', '🎊', '✦'],
    }[theme];
    if (!symbols) return;
    const layer = document.createElement('div');
    layer.className = `sedx-theme-particles sedx-theme-particles-${theme}`;
    layer.dataset.sedxThemeParticles = theme;
    layer.setAttribute('aria-hidden', 'true');
    const count = window.matchMedia('(max-width: 600px)').matches ? 14 : 26;
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement('span');
      particle.textContent = symbols[index % symbols.length];
      particle.style.setProperty('--particle-x', `${Math.random() * 100}%`);
      particle.style.setProperty('--particle-size', `${8 + Math.random() * (theme === 'christmas' ? 9 : 12)}px`);
      particle.style.setProperty('--particle-duration', `${11 + Math.random() * 14}s`);
      particle.style.setProperty('--particle-delay', `${-Math.random() * 24}s`);
      particle.style.setProperty('--particle-drift', `${Math.round(Math.random() * 100 - 50)}px`);
      layer.appendChild(particle);
    }
    document.body.appendChild(layer);
  }

  function applyTheme(value) {
    const theme = THEMES.has(value) ? value : 'default';
    activeTheme = theme;
    document.body.classList.remove('sedx-theme-halloween', 'sedx-theme-christmas', 'sedx-theme-kids');
    if (theme !== 'default') document.body.classList.add(`sedx-theme-${theme}`);
    document.documentElement.dataset.sedxTheme = theme;
    try { localStorage.setItem(THEME_STORAGE, JSON.stringify(theme)); } catch {}
    makeParticles(theme);
  }

  function loadCachedTheme() {
    try {
      const stored = localStorage.getItem(THEME_STORAGE);
      if (stored) applyTheme(JSON.parse(stored));
    } catch { applyTheme('default'); }
  }
  window.addEventListener('sedx:theme-change', (event) => applyTheme(event.detail?.activeTheme ?? event.detail?.theme));

  async function checkMaintenance() {
    const adminView = location.pathname === '/admin' || location.pathname === '/admin-tab' || isAdmin();
    try {
      const state = await request('/site-state');
      if (Object.prototype.hasOwnProperty.call(state, 'activeTheme')) applyTheme(state.activeTheme);
      if (adminView) {
        document.querySelector('[data-sedx-maintenance]')?.remove();
        return;
      }
      if (state.maintenance) showMaintenance(state.maintenanceMessage);
      else document.querySelector('[data-sedx-maintenance]')?.remove();
    } catch (error) { console.warn('[SedX estado público]', error); }
  }
  function showMaintenance(message) {
    if (document.querySelector('[data-sedx-maintenance]')) return;
    const overlay = document.createElement('div');
    overlay.dataset.sedxMaintenance = 'true';
    overlay.className = 'sedx-maintenance-screen';
    overlay.innerHTML = `<div class="sedx-maintenance-card"><img src="/sedx-logo-login-dashboard.png" alt="SEDX"><span class="admin-kicker">Atualização em andamento</span><h1>O SedX está em manutenção</h1><p>${esc(message || 'Estamos fazendo alguns ajustes para deixar o site mais rápido, estável e seguro. Volte mais tarde para continuar seus estudos.')}</p><small>Agradecemos a compreensão. Assim que o trabalho for concluído, o acesso será liberado automaticamente.</small></div>`;
    document.body.appendChild(overlay);
  }

  async function openNotifications() {
    const state = await request('/site-state');
    const notices = Array.isArray(state.notifications) ? state.notifications : [];
    const readIds = readNotificationIds();
    document.querySelector('[data-sedx-notice-modal]')?.remove();
    const modal = document.createElement('div');
    modal.dataset.sedxNoticeModal = 'true'; modal.className = 'sedx-notice-backdrop';
    modal.innerHTML = `<section class="sedx-notice-modal" role="dialog" aria-modal="true" aria-labelledby="sedx-notice-title"><header><div><span class="admin-kicker">Central de comunicação</span><h2 id="sedx-notice-title">Notificações</h2></div><div class="sedx-notice-header-actions"><button type="button" data-mark-notifications-read>Marcar como lidas</button><button data-close-notices aria-label="Fechar">×</button></div></header><div class="sedx-push-panel"><div><strong>Receba avisos do SEDX</strong><p data-push-status>Ative para receber publicações, novas tarefas e o lembrete de aula.</p></div><div class="sedx-push-actions"><button type="button" data-push-enable>Ativar notificações</button><button type="button" data-push-disable hidden>Desativar</button></div></div><div class="sedx-notice-list">${notices.length ? notices.map((notice, index) => `<article class="${readIds.has(notificationId(notice, index)) ? 'is-read' : 'is-unread'}"><time>${new Date(notice.publishedAt).toLocaleDateString('pt-BR')}</time><div>${notice.image ? `<img class="sedx-notice-image" src="${esc(notice.image)}" alt="">` : ''}<h3>${esc(notice.title)}</h3><p>${esc(notice.description)}</p><small>${esc(notice.audience || 'Todos os alunos')}</small></div></article>`).join('') : '<div class="admin-empty">Você está em dia. Nenhuma notificação nova.</div>'}</div></section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-close-notices]')) { modal.remove(); return; }
      if (event.target.closest('[data-mark-notifications-read]')) { markNotificationsRead(notices); const button = modal.querySelector('[data-mark-notifications-read]'); if (button) { button.textContent = 'Todas marcadas como lidas'; button.disabled = true; } modal.querySelectorAll('article').forEach((article) => { article.classList.remove('is-unread'); article.classList.add('is-read'); }); updateNotificationBadge(notices); return; }
      if (event.target.closest('[data-push-enable]')) { void enablePush(modal); return; }
      if (event.target.closest('[data-push-disable]')) void disablePush(modal);
    });
    void refreshPushStatus(modal);
  }

  function pushHeaders() {
    const current = session() || {};
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
    if (current.token2) headers.set('X-Token2', current.token2);
    if (current.token) headers.set('X-Token', current.token);
    if (current.usuario) headers.set('X-Usuario', current.usuario);
    const cdUsuario = current.cdUsuarioCurto || current.codigoAluno || current.cdAluno || current.ra || current.cdUsuario || '';
    if (cdUsuario) headers.set('X-Cd-Usuario', cdUsuario);
    if (current.apelido) headers.set('X-Task-User', current.apelido);
    return headers;
  }
  async function pushRequest(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${WORKER_URL}${path}`, {
      method, cache: 'no-store', headers: body === undefined && method === 'GET' ? { Accept: 'application/json' } : pushHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || `Falha ao configurar notificações (${response.status}).`);
    return data;
  }
  function pushPanelText(modal, message) {
    const element = modal.querySelector('[data-push-status]');
    if (element) element.textContent = message;
  }
  async function refreshPushStatus(modal) {
    const enable = modal.querySelector('[data-push-enable]');
    const disable = modal.querySelector('[data-push-disable]');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      pushPanelText(modal, 'Este navegador não oferece suporte a notificações push.');
      if (enable) enable.disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      pushPanelText(modal, 'As notificações foram bloqueadas nas configurações do navegador. Libere a permissão para ativá-las.');
      if (enable) enable.disabled = true;
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        pushPanelText(modal, 'Notificações ativadas neste dispositivo: publicações, novas tarefas e lembrete da primeira aula em dias úteis.');
        if (enable) enable.hidden = true;
        if (disable) disable.hidden = false;
      }
    } catch { /* O botão de ativação tentará registrar novamente. */ }
  }
  function applicationServerKey(value) {
    const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  async function enablePush(modal) {
    const button = modal.querySelector('[data-push-enable]');
    const current = session();
    if (!current?.token2 || !current?.token || !current?.usuario) {
      pushPanelText(modal, 'Entre novamente na sua conta do SEDX para ativar as notificações.');
      return;
    }
    if (button) { button.disabled = true; button.textContent = 'Ativando…'; }
    let step = 'solicitando permissão do navegador';
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('Este navegador não oferece suporte a notificações push.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permita as notificações do navegador nas configurações para continuar.');
      step = 'registrando o service worker';
      await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
      step = 'aguardando o service worker ficar pronto';
      const registration = await navigator.serviceWorker.ready;
      step = 'carregando a chave de inscrição push';
      const config = await pushRequest('/push/config');
      if (!config.publicKey) throw new Error('O servidor não forneceu a chave pública de notificações.');
      step = 'criando a inscrição deste dispositivo';
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
      }
      step = 'salvando a inscrição no SEDX';
      const response = await pushRequest('/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON() } });
      pushPanelText(modal, response.message || 'Notificações ativadas neste dispositivo.');
      await refreshPushStatus(modal);
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : 'O navegador não retornou detalhes do erro.';
      console.error('[SEDX push] falha ao ativar notificações', step, error);
      pushPanelText(modal, `Não foi possível ativar as notificações ao ${step}: ${message}`);
      if (button) { button.hidden = false; button.textContent = 'Tentar novamente'; }
    } finally { if (button && !button.hidden) button.disabled = false; }
  }
  async function disablePush(modal) {
    const button = modal.querySelector('[data-push-disable]');
    if (button) button.disabled = true;
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await pushRequest('/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      if (button) button.hidden = true;
      const enable = modal.querySelector('[data-push-enable]');
      if (enable) { enable.hidden = false; enable.textContent = 'Ativar notificações'; }
      pushPanelText(modal, 'Notificações desativadas neste dispositivo.');
    } catch (error) { pushPanelText(modal, error.message || 'Não foi possível desativar neste momento.'); }
    finally { if (button) button.disabled = false; }
  }

  function updateNotificationBadge(notices, button = document.querySelector('[data-sedx-notification-button]')) { if (!button) return; const read = readNotificationIds(); const unread = notices.filter((notice, index) => !read.has(notificationId(notice, index))).length; button.querySelector('b').textContent = unread > 9 ? '9+' : unread || ''; button.classList.toggle('has-notifications', unread > 0); }
  function injectNotificationButton() {
    if (location.pathname !== '/' || document.querySelector('[data-sedx-notification-button]')) return;
    const topbar = document.querySelector('.topbar'); if (!topbar) return;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.sedxNotificationButton = 'true'; button.className = 'sedx-notification-button'; button.title = 'Notificações'; button.setAttribute('aria-label', 'Abrir notificações');
    button.innerHTML = '<span class="sedx-bell" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></span><b></b>'; button.addEventListener('click', () => openNotifications().catch(console.error));
    const spacer = topbar.querySelector('.topbar-spacer'); spacer ? spacer.after(button) : topbar.prepend(button);
    request('/site-state').then((state) => updateNotificationBadge(Array.isArray(state.notifications) ? state.notifications : [], button)).catch(() => {});
  }

  function adminRoute() {
    if (location.pathname === '/admin' || location.pathname === '/admin-tab') {
      sessionStorage.setItem('sedx_admin_login_intent', '1');
      if (isAdmin() && window.__sedxAdminOpen && !document.querySelector('[data-admin-backdrop]')) window.__sedxAdminOpen();
    } else if (sessionStorage.getItem('sedx_admin_login_intent') === '1' && isAdmin()) {
      sessionStorage.removeItem('sedx_admin_login_intent');
      history.replaceState({}, '', '/admin-tab');
      if (window.__sedxAdminOpen && !document.querySelector('[data-admin-backdrop]')) window.__sedxAdminOpen();
    }
  }
  const boot = () => { loadCachedTheme(); checkMaintenance(); adminRoute(); injectNotificationButton(); const observer = new MutationObserver(() => { adminRoute(); injectNotificationButton(); }); observer.observe(document.body, { childList: true, subtree: true }); setInterval(checkMaintenance, 60000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

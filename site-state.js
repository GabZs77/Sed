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

  function pushHeaders() {
    const current = session();
    const headers = new Headers({ Accept: 'application/json' });
    if (current?.token2) headers.set('X-Token2', current.token2);
    if (current?.token) headers.set('X-Token', current.token);
    if (current?.cdUsuarioCurto || current?.codigoAluno || current?.cdAluno) headers.set('X-Cd-Usuario', current.cdUsuarioCurto || current.codigoAluno || current.cdAluno);
    if (current?.apelido) headers.set('X-Task-User', current.apelido);
    if (current?.usuario) headers.set('X-Usuario', current.usuario);
    return headers;
  }

  function pushSessionReady() {
    const current = session();
    return Boolean(current?.token && current?.token2 && (current?.cdUsuarioCurto || current?.codigoAluno || current?.cdAluno) && current?.usuario);
  }

  async function pushRequest(path, options = {}) {
    const headers = pushHeaders();
    const requestOptions = { method: options.method || 'GET', headers, cache: 'no-store' };
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      requestOptions.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${WORKER_URL}${path}`, requestOptions);
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data?.erro || data?.error || 'Não foi possível atualizar as notificações.');
    return data || {};
  }

  function applicationServerKeyBytes(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function syncPushControls(modal) {
    const button = modal.querySelector('[data-sedx-push-toggle]');
    const status = modal.querySelector('[data-sedx-push-status]');
    if (!button || !status) return;
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      button.disabled = true;
      status.textContent = 'Este navegador não oferece suporte a notificações push.';
      return;
    }
    let subscription = null;
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      subscription = await registration?.pushManager.getSubscription() || null;
    } catch {}
    if (subscription) {
      button.disabled = false;
      button.dataset.active = 'true';
      button.textContent = 'Desativar neste dispositivo';
      status.textContent = 'Ativas neste dispositivo.';
      if (pushSessionReady()) {
        try {
          await pushRequest('/push/subscribe', {
            method: 'POST',
            body: { subscription: subscription.toJSON(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' },
          });
        } catch {
          status.textContent = 'Ativas no navegador; a sincronização será tentada novamente.';
        }
      }
      return;
    }
    button.dataset.active = 'false';
    button.textContent = 'Ativar notificações';
    if (!pushSessionReady()) {
      button.disabled = true;
      status.textContent = 'Entre na sua conta para ativar as notificações.';
    } else if (Notification.permission === 'denied') {
      button.disabled = true;
      status.textContent = 'Permissão bloqueada. Altere as configurações de notificações do navegador.';
    } else {
      button.disabled = false;
      status.textContent = 'Receba avisos publicados, novas tarefas e lembretes de aula.';
    }
  }

  async function togglePush(modal) {
    const button = modal.querySelector('[data-sedx-push-toggle]');
    const status = modal.querySelector('[data-sedx-push-status]');
    if (!button || !status) return;
    button.disabled = true;
    status.textContent = 'Atualizando…';
    try {
      if (button.dataset.active !== 'true') {
        if (!pushSessionReady()) throw new Error('Faça login para ativar as notificações.');
        let permission = Notification.permission;
        if (permission === 'default') permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('A permissão de notificações não foi concedida.');
      }
      const registration = await navigator.serviceWorker.getRegistration('/');
      const currentSubscription = await registration?.pushManager.getSubscription();
      if (currentSubscription) {
        await pushRequest('/push/unsubscribe', { method: 'POST', body: { endpoint: currentSubscription.endpoint } });
        await currentSubscription.unsubscribe();
        button.dataset.active = 'false';
        button.textContent = 'Ativar notificações';
        status.textContent = 'Notificações desativadas neste dispositivo.';
        button.disabled = !pushSessionReady();
        return;
      }
      if (!pushSessionReady()) throw new Error('Faça login para ativar as notificações.');
      const activeRegistration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const config = await pushRequest('/push/config');
      if (!config.publicKey) throw new Error('A configuração push não está disponível.');
      const subscription = await activeRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKeyBytes(config.publicKey),
      });
      try {
        await pushRequest('/push/subscribe', {
          method: 'POST',
          body: { subscription: subscription.toJSON(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' },
        });
      } catch (error) {
        await subscription.unsubscribe();
        throw error;
      }
      button.dataset.active = 'true';
      button.textContent = 'Desativar neste dispositivo';
      status.textContent = 'Notificações ativadas neste dispositivo.';
      button.disabled = false;
    } catch (error) {
      status.textContent = error.message || 'Não foi possível atualizar as notificações.';
      button.disabled = false;
    }
  }

  async function openNotifications() {
    const state = await request('/site-state');
    const notices = Array.isArray(state.notifications) ? state.notifications : [];
    document.querySelector('[data-sedx-notice-modal]')?.remove();
    const modal = document.createElement('div');
    modal.dataset.sedxNoticeModal = 'true'; modal.className = 'sedx-notice-backdrop';
    modal.innerHTML = `<section class="sedx-notice-modal" role="dialog" aria-modal="true" aria-labelledby="sedx-notice-title"><header><div><span class="admin-kicker">Central de comunicação</span><h2 id="sedx-notice-title">Notificações</h2></div><button data-close-notices aria-label="Fechar">×</button></header><div class="sedx-push-controls"><div><strong>Notificações no navegador</strong><span data-sedx-push-status role="status">Verificando este dispositivo…</span></div><button type="button" data-sedx-push-toggle>Ativar notificações</button></div><div class="sedx-notice-list">${notices.length ? notices.map((notice) => `<article><time>${new Date(notice.publishedAt).toLocaleDateString('pt-BR')}</time><div>${notice.image ? `<img class="sedx-notice-image" src="${esc(notice.image)}" alt="">` : ''}<h3>${esc(notice.title)}</h3><p>${esc(notice.description)}</p><small>${esc(notice.audience || 'Todos os alunos')}</small></div></article>`).join('') : '<div class="admin-empty">Você está em dia. Nenhuma notificação nova.</div>'}</div></section>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-sedx-push-toggle]')?.addEventListener('click', () => togglePush(modal));
    void syncPushControls(modal);
    modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-close-notices]')) modal.remove(); });
  }

  function injectNotificationButton() {
    if (location.pathname !== '/' || document.querySelector('[data-sedx-notification-button]')) return;
    const topbar = document.querySelector('.topbar'); if (!topbar) return;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.sedxNotificationButton = 'true'; button.className = 'sedx-notification-button'; button.title = 'Notificações'; button.setAttribute('aria-label', 'Abrir notificações');
    button.innerHTML = '<span class="sedx-bell" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></span><b></b>'; button.addEventListener('click', () => openNotifications().catch(console.error));
    const spacer = topbar.querySelector('.topbar-spacer'); spacer ? spacer.after(button) : topbar.prepend(button);
    request('/site-state').then((state) => { const count = Array.isArray(state.notifications) ? state.notifications.length : 0; button.querySelector('b').textContent = count > 9 ? '9+' : count || ''; button.classList.toggle('has-notifications', count > 0); }).catch(() => {});
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

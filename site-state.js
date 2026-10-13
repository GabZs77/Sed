(() => {
  'use strict';
  const WORKER_URL = 'https://sdf.gabrielreplit56.workers.dev';
  const ADMIN_RAS = new Set(['1127620514', '1127241606']);
  const session = () => { try { return JSON.parse(localStorage.getItem('sed_sessao') || 'null'); } catch { return null; } };
  const isAdmin = () => ADMIN_RAS.has(String(session()?.usuario || '').replace(/\D/g, ''));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  const request = async (path) => { const response = await fetch(`${WORKER_URL}${path}`, { cache: 'no-store' }); return response.json(); };

  async function checkMaintenance() {
    if (location.pathname === '/admin' || location.pathname === '/admin-tab' || isAdmin()) return;
    try {
      const state = await request('/site-state');
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
    document.querySelector('[data-sedx-notice-modal]')?.remove();
    const modal = document.createElement('div');
    modal.dataset.sedxNoticeModal = 'true'; modal.className = 'sedx-notice-backdrop';
    modal.innerHTML = `<section class="sedx-notice-modal" role="dialog" aria-modal="true" aria-labelledby="sedx-notice-title"><header><div><span class="admin-kicker">Central de comunicação</span><h2 id="sedx-notice-title">Notificações</h2></div><button data-close-notices aria-label="Fechar">×</button></header><div class="sedx-notice-list">${notices.length ? notices.map((notice) => `<article><time>${new Date(notice.publishedAt).toLocaleDateString('pt-BR')}</time><div>${notice.image ? `<img class="sedx-notice-image" src="${esc(notice.image)}" alt="">` : ''}<h3>${esc(notice.title)}</h3><p>${esc(notice.description)}</p><small>${esc(notice.audience || 'Todos os alunos')}</small></div></article>`).join('') : '<div class="admin-empty">Você está em dia. Nenhuma notificação nova.</div>'}</div></section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-close-notices]')) modal.remove(); });
  }

  function injectNotificationButton() {
    if (location.pathname !== '/' || document.querySelector('[data-sedx-notification-button]')) return;
    const topbar = document.querySelector('.topbar'); if (!topbar) return;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.sedxNotificationButton = 'true'; button.className = 'sedx-notification-button'; button.title = 'Notificações'; button.setAttribute('aria-label', 'Abrir notificações');
    button.innerHTML = '<span class="sedx-bell">♢</span><b></b>'; button.addEventListener('click', () => openNotifications().catch(console.error));
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
  const boot = () => { checkMaintenance(); adminRoute(); injectNotificationButton(); const observer = new MutationObserver(() => { adminRoute(); injectNotificationButton(); }); observer.observe(document.body, { childList: true, subtree: true }); setInterval(checkMaintenance, 60000); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

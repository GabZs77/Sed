(() => {
  'use strict';

  const TAB_PARAM = 'sedxTab';
  const LEGACY_TAB_VALUE = 'plataformas';
  const TAB_VALUE = 'ferramentas';
  let overlay = null;
  let returnUrl = '';

  function urlWithoutToolsTab() {
    const params = new URLSearchParams(location.search);
    params.delete(TAB_PARAM);
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  }

  function isToolsTab() {
    const value = new URLSearchParams(location.search).get(TAB_PARAM);
    return value === TAB_VALUE || value === LEGACY_TAB_VALUE;
  }

  function setNavActive(active) {
    document.querySelectorAll('[data-sedx-platform-link]').forEach((link) => {
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function injectNavLinks() {
    const rail = document.querySelector('.side-rail .rail-nav');
    if (rail && !rail.querySelector('[data-sedx-platform-link]')) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'rail-link sedx-platforms-nav-link';
      link.dataset.sedxPlatformLink = 'desktop';
      link.setAttribute('aria-label', 'Abrir Ferramentas');
      link.innerHTML = '<span class="platform-nav-icon" aria-hidden="true">▧</span><span>Ferramentas</span>';
      rail.appendChild(link);
    }

    const bottom = document.querySelector('.bottom-nav');
    if (bottom && !bottom.querySelector('[data-sedx-platform-link]')) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'bottom-link sedx-platforms-bottom-link';
      link.dataset.sedxPlatformLink = 'mobile';
      link.setAttribute('aria-label', 'Abrir Ferramentas');
      link.innerHTML = '<span class="bottom-icon-wrap"><span class="platform-nav-icon" aria-hidden="true">▧</span></span><span>Ferramentas</span>';
      bottom.appendChild(link);
    }
  }

  function renderPage() {
    overlay = document.createElement('section');
    overlay.className = 'sedx-platforms-overlay';
    overlay.dataset.sedxPlatformsOverlay = 'true';
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'Ferramentas');
    overlay.innerHTML = `
      <div class="platforms-tab-panel">
        <header class="platforms-tab-heading">
          <div>
            <span class="eyebrow">Área de ferramentas</span>
            <h1>Ferramentas</h1>
            <p>Recursos disponíveis para apoiar sua rotina de estudos.</p>
          </div>
          <button type="button" class="platforms-close" data-platforms-close aria-label="Fechar Ferramentas">×</button>
        </header>
        <div class="tools-empty-state" role="status">
          <span class="tools-empty-icon" aria-hidden="true">▧</span>
          <h2>Nenhuma ferramenta disponível no momento</h2>
          <p>Novas ferramentas poderão ser adicionadas aqui futuramente.</p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    setNavActive(true);
    overlay.querySelector('[data-platforms-close]')?.focus();
  }

  function openTab({ updateHistory = true } = {}) {
    if (!document.querySelector('.app-shell')) return;
    if (overlay?.isConnected) { setNavActive(true); return; }
    const params = new URLSearchParams(location.search);
    if (updateHistory && !params.has(TAB_PARAM)) {
      returnUrl = urlWithoutToolsTab();
      params.set(TAB_PARAM, TAB_VALUE);
      history.pushState({ ...(history.state || {}), sedxPlatformTab: true, sedxReturnUrl: returnUrl }, '', `${location.pathname}?${params.toString()}${location.hash}`);
    } else if (!returnUrl) {
      returnUrl = history.state?.sedxReturnUrl || urlWithoutToolsTab();
    }
    renderPage();
  }

  function closeTab({ restoreUrl = true } = {}) {
    overlay?.remove();
    overlay = null;
    setNavActive(false);
    if (restoreUrl && new URLSearchParams(location.search).has(TAB_PARAM)) {
      const target = returnUrl || urlWithoutToolsTab();
      history.replaceState({ ...(history.state || {}), sedxPlatformTab: false }, '', target);
    }
  }

  document.addEventListener('click', (event) => {
    const toolsLink = event.target.closest('[data-sedx-platform-link]');
    if (toolsLink) { event.preventDefault(); openTab(); return; }
    if (overlay && event.target.closest('[data-platforms-close]')) { closeTab(); return; }
    const otherNav = event.target.closest('.rail-nav .rail-link, .bottom-nav .bottom-link');
    if (overlay && otherNav) closeTab();
  });

  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay) closeTab(); });
  window.addEventListener('popstate', () => {
    if (isToolsTab()) openTab({ updateHistory: false });
    else closeTab({ restoreUrl: false });
  });

  function boot() {
    injectNavLinks();
    if (isToolsTab()) openTab({ updateHistory: false });
    const observer = new MutationObserver(() => {
      injectNavLinks();
      if (isToolsTab() && !overlay?.isConnected) openTab({ updateHistory: false });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

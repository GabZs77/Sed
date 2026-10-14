(() => {
  'use strict';

  const WORKER_URL = 'https://sdf.gabrielreplit56.workers.dev';
  const TAB_PARAM = 'sedxTab';
  let overlay = null;
  let returnUrl = '';

  function session() {
    try { return JSON.parse(localStorage.getItem('sed_sessao') || 'null'); } catch { return null; }
  }

  function browserFingerprint() {
    const hints = navigator.userAgentData;
    const brands = Array.isArray(hints?.brands)
      ? hints.brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', ')
      : '';
    const platform = hints?.platform || navigator.platform || 'Android';
    return {
      user_agent: navigator.userAgent || '',
      sec_ch_ua: brands,
      sec_ch_ua_mobile: hints?.mobile ? '?1' : '?0',
      sec_ch_ua_platform: JSON.stringify(platform),
    };
  }

  function urlWithoutPlatformTab() {
    const params = new URLSearchParams(location.search);
    params.delete(TAB_PARAM);
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
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
      link.setAttribute('aria-label', 'Abrir Plataformas');
      link.innerHTML = '<span class="platform-nav-icon" aria-hidden="true">▧</span><span>Plataformas</span>';
      rail.appendChild(link);
    }

    const bottom = document.querySelector('.bottom-nav');
    if (bottom && !bottom.querySelector('[data-sedx-platform-link]')) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'bottom-link sedx-platforms-bottom-link';
      link.dataset.sedxPlatformLink = 'mobile';
      link.setAttribute('aria-label', 'Abrir Plataformas');
      link.innerHTML = '<span class="bottom-icon-wrap"><span class="platform-nav-icon" aria-hidden="true">▧</span></span><span>Plataformas</span>';
      bottom.appendChild(link);
    }
  }

  function renderPage() {
    overlay = document.createElement('section');
    overlay.className = 'sedx-platforms-overlay';
    overlay.dataset.sedxPlatformsOverlay = 'true';
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'Plataformas');
    overlay.innerHTML = `
      <div class="platforms-tab-panel">
        <header class="platforms-tab-heading">
          <div>
            <span class="eyebrow">Suas ferramentas de leitura</span>
            <h1>Plataformas</h1>
            <p>Acesse serviços educacionais com a sessão segura da sua conta SedX.</p>
          </div>
          <button type="button" class="platforms-close" data-platforms-close aria-label="Fechar Plataformas">×</button>
        </header>
        <article class="leiasp-platform-card">
          <div class="leiasp-card-topline">
            <div class="leiasp-brand-mark" aria-hidden="true">L<span>+</span></div>
            <span class="leiasp-availability"><i></i> Plataforma disponível</span>
          </div>
          <div class="leiasp-card-copy">
            <span class="platform-card-kicker">LEITURA DIGITAL</span>
            <h2>LeiaSP</h2>
            <p>Entre na plataforma de leitura da Secretaria da Educação de São Paulo usando a sessão oficial já iniciada no SedX.</p>
          </div>
          <div class="leiasp-card-details">
            <div><span class="leiasp-detail-icon" aria-hidden="true">↗</span><span>A autenticação será concluída no site oficial do LeiaSP.</span></div>
            <div><span class="leiasp-detail-icon" aria-hidden="true">⌑</span><span>Não pedimos nem salvamos sua senha do LeiaSP.</span></div>
          </div>
          <div class="leiasp-card-actions">
            <button type="button" class="leiasp-login-button" data-leiasp-login><span aria-hidden="true">Entrar no LeiaSP</span><span aria-hidden="true">→</span></button>
            <a class="leiasp-official-link" href="https://reader.elefanteletrado.com.br/" target="_blank" rel="noopener noreferrer">Site oficial</a>
          </div>
          <p class="leiasp-status" data-leiasp-status role="status" aria-live="polite">A autenticação usa o token SED temporário da sua sessão atual.</p>
        </article>
        <p class="platforms-privacy-note"><span aria-hidden="true">●</span> O token da sessão SedX é enviado ao Worker por POST. O fluxo continua em HTTPS no domínio oficial do leitor.</p>
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
      returnUrl = urlWithoutPlatformTab();
      params.set(TAB_PARAM, 'plataformas');
      history.pushState({ ...(history.state || {}), sedxPlatformTab: true, sedxReturnUrl: returnUrl }, '', `${location.pathname}?${params.toString()}${location.hash}`);
    } else if (!returnUrl) {
      returnUrl = history.state?.sedxReturnUrl || urlWithoutPlatformTab();
    }
    renderPage();
  }

  function closeTab({ restoreUrl = true } = {}) {
    overlay?.remove();
    overlay = null;
    setNavActive(false);
    if (restoreUrl && new URLSearchParams(location.search).has(TAB_PARAM)) {
      const target = returnUrl || urlWithoutPlatformTab();
      history.replaceState({ ...(history.state || {}), sedxPlatformTab: false }, '', target);
    }
  }

  function openLeiaSP() {
    const button = overlay?.querySelector('[data-leiasp-login]');
    const status = overlay?.querySelector('[data-leiasp-status]');
    const currentSession = session();
    const tokenSed = typeof currentSession?.token === 'string' ? currentSession.token.trim() : '';
    if (!tokenSed || tokenSed === 'null' || tokenSed === 'undefined') {
      if (status) status.textContent = 'Sua sessão não contém um token SED válido. Saia do SedX e entre novamente antes de abrir o LeiaSP.';
      return;
    }

    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    if (status) status.textContent = 'Conectando ao LeiaSP com a sessão atual do SedX…';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${WORKER_URL}/leiasp/login`;
    form.target = '_blank';
    form.enctype = 'application/x-www-form-urlencoded';
    form.setAttribute('rel', 'noopener noreferrer');
    form.hidden = true;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'token_sed';
    input.value = tokenSed;
    form.appendChild(input);
    for (const [name, value] of Object.entries(browserFingerprint())) {
      const hint = document.createElement('input');
      hint.type = 'hidden';
      hint.name = name;
      hint.value = value;
      form.appendChild(hint);
    }
    document.body.appendChild(form);
    try {
      form.submit();
      if (status) status.textContent = 'A solicitação foi enviada em uma nova aba. Se o navegador bloquear a abertura, permita pop-ups para concluir a autenticação.';
    } catch {
      if (status) status.textContent = 'Não foi possível abrir a janela do LeiaSP. Tente novamente ou use o site oficial.';
    } finally {
      form.remove();
      window.setTimeout(() => { if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); } }, 1200);
    }
  }

  document.addEventListener('click', (event) => {
    const platformLink = event.target.closest('[data-sedx-platform-link]');
    if (platformLink) { event.preventDefault(); openTab(); return; }
    if (overlay && event.target.closest('[data-platforms-close]')) { closeTab(); return; }
    if (overlay && event.target.closest('[data-leiasp-login]')) { openLeiaSP(); return; }
    const otherNav = event.target.closest('.rail-nav .rail-link, .bottom-nav .bottom-link');
    if (overlay && otherNav) closeTab();
  });

  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay) closeTab(); });
  window.addEventListener('popstate', () => {
    if (new URLSearchParams(location.search).get(TAB_PARAM) === 'plataformas') openTab({ updateHistory: false });
    else closeTab({ restoreUrl: false });
  });

  function boot() {
    injectNavLinks();
    if (new URLSearchParams(location.search).get(TAB_PARAM) === 'plataformas') openTab({ updateHistory: false });
    const observer = new MutationObserver(() => {
      injectNavLinks();
      if (new URLSearchParams(location.search).get(TAB_PARAM) === 'plataformas' && !overlay?.isConnected) openTab({ updateHistory: false });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

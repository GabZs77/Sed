(() => {
  'use strict';

  const WORKER_URL = 'https://sdf.gabrielreplit56.workers.dev';
  const TAB_PARAM = 'sedxTab';
  const TAB_VALUE = 'ferramentas';
  const ADMIN_RAS = new Set(['1127620514', '1127241606']);
  const MAX_IMAGE_BYTES = 250 * 1024;
  let overlay = null;
  let publishModal = null;
  let returnUrl = '';
  let tools = [];
  let pendingImage = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function getSession() {
    try { return JSON.parse(localStorage.getItem('sed_sessao') || 'null'); } catch { return null; }
  }

  function currentRa() { return String(getSession()?.usuario || '').replace(/\D/g, ''); }
  function isAdmin() { return ADMIN_RAS.has(currentRa()); }

  function urlWithoutToolsTab() {
    const params = new URLSearchParams(location.search);
    params.delete(TAB_PARAM);
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  }

  function setNavActive(active) {
    document.querySelectorAll('[data-sedx-tools-link]').forEach((link) => {
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function injectNavLinks() {
    const rail = document.querySelector('.side-rail .rail-nav');
    if (rail && !rail.querySelector('[data-sedx-tools-link]')) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'rail-link sedx-tools-nav-link';
      link.dataset.sedxToolsLink = 'desktop';
      link.setAttribute('aria-label', 'Abrir Ferramentas');
      link.innerHTML = '<span class="tools-nav-icon" aria-hidden="true">⚙</span><span>Ferramentas</span>';
      rail.appendChild(link);
    }
  }

  function renderToolList(message = '') {
    const list = overlay?.querySelector('[data-tools-list]');
    if (!list) return;
    if (message) {
      list.innerHTML = `<div class="tools-empty-state"><div class="tools-empty-icon" aria-hidden="true">⚙</div><div class="tools-empty-copy"><span class="tools-kicker">RECURSOS DO SEDX</span><h2>Não foi possível carregar as ferramentas</h2><p>${esc(message)}</p><button class="tools-retry-button" type="button" data-tools-retry>Tentar novamente</button></div></div>`;
      return;
    }
    if (!tools.length) {
      list.innerHTML = '<div class="tools-empty-state"><div class="tools-empty-icon" aria-hidden="true">⚙</div><div class="tools-empty-copy"><span class="tools-kicker">RECURSOS DO SEDX</span><h2>Nenhuma ferramenta disponível</h2><p>As ferramentas publicadas aparecerão aqui.</p></div></div>';
      return;
    }
    list.innerHTML = `<div class="tools-card-grid">${tools.map((tool) => {
      const action = tool.actionType === 'site' ? 'Ir para o site' : 'Copiar';
      const image = tool.image ? `<img class="tools-card-image" src="${esc(tool.image)}" alt="" loading="lazy">` : '';
      return `<article class="tools-card" data-tool-card="${esc(tool.id)}">${image}<div class="tools-card-content"><h2>${esc(tool.title)}</h2><p>${esc(tool.description)}</p><button type="button" class="tools-action-button" data-tool-action="${esc(tool.id)}">${action}<span aria-hidden="true">${tool.actionType === 'site' ? '↗' : '⧉'}</span></button><span class="tools-card-status" data-tool-status="${esc(tool.id)}" role="status" aria-live="polite"></span></div></article>`;
    }).join('')}</div>`;
  }

  async function loadTools() {
    const list = overlay?.querySelector('[data-tools-list]');
    if (list) list.innerHTML = '<p class="tools-loading" role="status">Carregando ferramentas…</p>';
    try {
      const response = await fetch(`${WORKER_URL}/site-state`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.erro || `Falha ao carregar (${response.status})`);
      tools = Array.isArray(data.tools) ? data.tools : [];
      renderToolList();
    } catch (error) {
      renderToolList(error.message || 'Verifique sua conexão e tente novamente.');
    }
  }

  function renderPage() {
    overlay?.remove();
    overlay = document.createElement('section');
    overlay.className = 'sedx-tools-overlay';
    overlay.dataset.sedxToolsOverlay = 'true';
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'Ferramentas');
    overlay.innerHTML = `
      <div class="tools-tab-panel">
        <header class="tools-tab-heading">
          <div>
            <span class="eyebrow">Utilidades do SedX</span>
            <h1>Ferramentas</h1>
            <p>Recursos complementares para apoiar sua rotina de estudos.</p>
          </div>
          <div class="tools-heading-actions">
            ${isAdmin() ? '<button type="button" class="tools-publish-button" data-tools-publish>＋ Publicar</button>' : ''}
            <button type="button" class="tools-close" data-tools-close aria-label="Fechar Ferramentas">×</button>
          </div>
        </header>
        <div data-tools-list><p class="tools-loading" role="status">Carregando ferramentas…</p></div>
      </div>`;
    document.body.appendChild(overlay);
    setNavActive(true);
    overlay.querySelector('[data-tools-close]')?.focus();
    void loadTools();
  }

  function openTools({ updateHistory = true } = {}) {
    if (!document.querySelector('.app-shell')) return;
    if (overlay?.isConnected) { setNavActive(true); void loadTools(); return; }
    const params = new URLSearchParams(location.search);
    if (updateHistory && params.get(TAB_PARAM) !== TAB_VALUE) {
      returnUrl = urlWithoutToolsTab();
      params.set(TAB_PARAM, TAB_VALUE);
      history.pushState({ ...(history.state || {}), sedxToolsTab: true, sedxReturnUrl: returnUrl }, '', `${location.pathname}?${params.toString()}${location.hash}`);
    } else if (!returnUrl) {
      returnUrl = history.state?.sedxReturnUrl || urlWithoutToolsTab();
    }
    renderPage();
  }

  function closeTools({ restoreUrl = true } = {}) {
    publishModal?.remove();
    publishModal = null;
    pendingImage = '';
    overlay?.remove();
    overlay = null;
    setNavActive(false);
    if (restoreUrl && new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) {
      const target = returnUrl || urlWithoutToolsTab();
      history.replaceState({ ...(history.state || {}), sedxToolsTab: false }, '', target);
    }
  }

  function openPublishModal() {
    if (!isAdmin() || !overlay?.isConnected) return;
    publishModal?.remove();
    pendingImage = '';
    publishModal = document.createElement('div');
    publishModal.className = 'tools-modal-backdrop';
    publishModal.dataset.toolsPublishModal = 'true';
    publishModal.innerHTML = `
      <section class="tools-publish-modal" role="dialog" aria-modal="true" aria-labelledby="tools-modal-title">
        <header class="tools-modal-heading"><div><span class="tools-kicker">PUBLICAÇÃO GLOBAL</span><h2 id="tools-modal-title">Nova ferramenta</h2></div><button type="button" class="tools-modal-close" data-tools-modal-close aria-label="Fechar">×</button></header>
        <form data-tools-publish-form>
          <label class="tools-field">Título<input name="title" maxlength="120" required autocomplete="off" placeholder="Ex.: Guia de estudos"></label>
          <label class="tools-field">Descrição<textarea name="description" rows="3" maxlength="1000" required placeholder="Explique brevemente o que esta ferramenta oferece"></textarea></label>
          <fieldset class="tools-action-choice"><legend>Botão que será exibido</legend><label><input type="radio" name="actionType" value="copy" checked><span><strong>Copiar</strong><small>O botão copia o conteúdo para a área de transferência.</small></span></label><label><input type="radio" name="actionType" value="site"><span><strong>Ir para o site</strong><small>O botão abre o endereço informado em uma nova aba.</small></span></label></fieldset>
          <label class="tools-field" for="tools-publish-content">Conteúdo<textarea id="tools-publish-content" name="content" rows="4" maxlength="4000" required placeholder="Digite o texto que será copiado"></textarea><small data-tools-content-hint>Esse texto será copiado quando o aluno clicar em “Copiar”.</small></label>
          <label class="tools-field">Imagem (opcional)<input name="imageFile" type="file" accept="image/*" data-tools-image><small>A imagem é otimizada no navegador e limitada a 250 KB.</small></label>
          <div class="tools-image-preview" data-tools-image-preview hidden><img alt="Prévia da imagem"><button type="button" data-tools-image-remove>Remover imagem</button></div>
          <p class="tools-form-error" data-tools-form-error role="alert" hidden></p>
          <footer class="tools-modal-actions"><button type="button" class="tools-cancel-button" data-tools-modal-close>Cancelar</button><button type="submit" class="tools-publish-button" data-tools-submit>Publicar</button></footer>
        </form>
      </section>`;
    document.body.appendChild(publishModal);
    publishModal.querySelector('[name="title"]')?.focus();
  }

  function closePublishModal() {
    publishModal?.remove();
    publishModal = null;
    pendingImage = '';
  }

  async function imageToDataUrl(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem válido.');
    let blob;
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const maxEdge = 1600;
      let scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      let canvas = document.createElement('canvas');
      for (let attempt = 0; attempt < 9; attempt += 1) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', Math.max(.42, .84 - attempt * .07)));
        if (blob && blob.size <= MAX_IMAGE_BYTES) break;
        if (attempt >= 3) scale *= .82;
      }
      bitmap.close?.();
    } else {
      if (file.size > MAX_IMAGE_BYTES) throw new Error('Este navegador não permite reduzir a imagem. Escolha um arquivo de até 250 KB.');
      blob = file;
    }
    if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('A imagem ficou maior que 250 KB mesmo após a redução. Escolha outra imagem.');
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
      reader.readAsDataURL(blob);
    });
  }

  function adminHeaders() {
    const session = getSession() || {};
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' });
    if (session.token2) headers.set('X-Token2', session.token2);
    if (session.token) headers.set('X-Token', session.token);
    if (session.usuario) headers.set('X-Usuario', session.usuario);
    if (session.cdUsuarioCurto) headers.set('X-Cd-Usuario', session.cdUsuarioCurto);
    headers.set('X-Admin-User', currentRa());
    return headers;
  }

  async function publishTool(payload) {
    if (!isAdmin()) throw new Error('Apenas administradores podem publicar ferramentas.');
    const response = await fetch(`${WORKER_URL}/admin/tools`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || `Falha ao publicar (${response.status})`);
    return data;
  }

  function validSiteUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }

  async function handlePublishSubmit(form) {
    if (!isAdmin()) return;
    const submit = form.querySelector('[data-tools-submit]');
    const errorBox = form.querySelector('[data-tools-form-error]');
    const values = new FormData(form);
    const title = String(values.get('title') || '').trim();
    const description = String(values.get('description') || '').trim();
    const content = String(values.get('content') || '').trim();
    const actionType = String(values.get('actionType') || 'copy');
    if (!title || !description || !content) return showFormError(errorBox, 'Preencha título, descrição e conteúdo.');
    if (actionType === 'site' && !validSiteUrl(content)) return showFormError(errorBox, 'Informe um endereço válido começando com http:// ou https://.');
    if (!['copy', 'site'].includes(actionType)) return showFormError(errorBox, 'Selecione uma ação válida.');
    if (submit) { submit.disabled = true; submit.textContent = 'Publicando…'; }
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
    try {
      await publishTool({
        id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        title,
        description,
        content,
        actionType,
        image: pendingImage,
      });
      closePublishModal();
      await loadTools();
    } catch (error) {
      showFormError(errorBox, error.message || 'Não foi possível publicar. Tente novamente.');
      if (submit) { submit.disabled = false; submit.textContent = 'Publicar'; }
    }
  }

  function showFormError(box, message) {
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('A cópia não foi permitida pelo navegador.');
  }

  async function runToolAction(button) {
    const id = button.dataset.toolAction;
    const item = tools.find((tool) => String(tool.id) === String(id));
    if (!item) return;
    const status = overlay?.querySelector(`[data-tool-status="${CSS.escape(String(id))}"]`);
    try {
      if (item.actionType === 'site') {
        if (!validSiteUrl(String(item.content || ''))) throw new Error('O endereço publicado não é válido.');
        const link = document.createElement('a');
        link.href = item.content;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        if (status) status.textContent = 'Site aberto em uma nova aba.';
      } else {
        await copyText(String(item.content || ''));
        if (status) status.textContent = 'Conteúdo copiado.';
      }
    } catch (error) {
      if (status) status.textContent = error.message || 'Não foi possível concluir a ação.';
    }
  }

  document.addEventListener('click', (event) => {
    const toolsLink = event.target.closest('[data-sedx-tools-link]');
    if (toolsLink) { event.preventDefault(); openTools(); return; }
    if (overlay && event.target.closest('[data-tools-close]')) { closeTools(); return; }
    if (overlay && event.target.closest('[data-tools-publish]')) { openPublishModal(); return; }
    if (publishModal && (event.target.closest('[data-tools-modal-close]') || event.target === publishModal)) { closePublishModal(); return; }
    if (publishModal && event.target.closest('[data-tools-image-remove]')) {
      pendingImage = '';
      const fileInput = publishModal.querySelector('[data-tools-image]');
      if (fileInput) fileInput.value = '';
      const preview = publishModal.querySelector('[data-tools-image-preview]');
      if (preview) preview.hidden = true;
      return;
    }
    if (overlay && event.target.closest('[data-tools-retry]')) { void loadTools(); return; }
    const toolButton = overlay && event.target.closest('[data-tool-action]');
    if (toolButton) { void runToolAction(toolButton); return; }
    const otherNav = event.target.closest('.rail-nav .rail-link');
    if (overlay && otherNav) closeTools();
  });

  document.addEventListener('change', async (event) => {
    if (!publishModal) return;
    if (event.target.matches('[name="actionType"]')) {
      const isSite = event.target.value === 'site';
      const content = publishModal.querySelector('[name="content"]');
      const hint = publishModal.querySelector('[data-tools-content-hint]');
      if (content) { content.placeholder = isSite ? 'https://exemplo.com' : 'Digite o texto que será copiado'; content.maxLength = isSite ? 2048 : 4000; }
      if (hint) hint.textContent = isSite ? 'O botão abrirá esse endereço em uma nova aba.' : 'Esse texto será copiado quando o aluno clicar em “Copiar”.';
    }
    if (event.target.matches('[data-tools-image]')) {
      const file = event.target.files?.[0];
      if (!file) return;
      const errorBox = publishModal.querySelector('[data-tools-form-error]');
      try {
        pendingImage = await imageToDataUrl(file);
        const preview = publishModal.querySelector('[data-tools-image-preview]');
        const image = preview?.querySelector('img');
        if (image) image.src = pendingImage;
        if (preview) preview.hidden = false;
        if (errorBox) errorBox.hidden = true;
      } catch (error) {
        pendingImage = '';
        event.target.value = '';
        showFormError(errorBox, error.message || 'Não foi possível processar essa imagem.');
      }
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.matches('[data-tools-publish-form]')) {
      event.preventDefault();
      void handlePublishSubmit(event.target);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (publishModal) closePublishModal();
    else if (overlay) closeTools();
  });
  window.addEventListener('popstate', () => {
    if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) openTools({ updateHistory: false });
    else closeTools({ restoreUrl: false });
  });

  function boot() {
    injectNavLinks();
    if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) openTools({ updateHistory: false });
    const observer = new MutationObserver(() => {
      injectNavLinks();
      if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE && !overlay?.isConnected) openTools({ updateHistory: false });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

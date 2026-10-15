(() => {
  'use strict';

  const WORKER_URL = 'https://sdf.gabrielreplit56.workers.dev';
  const TAB_PARAM = 'sedxTab';
  const TAB_VALUE = 'parcerias';
  const ADMIN_RAS = new Set(['1127620514', '1127241606']);
  const ALLOWED_TYPES = new Set(['Discord', 'WhatsApp', 'Outro']);
  const MAX_IMAGE_BYTES = 250 * 1024;
  const MAX_IMAGE_DATA_LENGTH = 350000;
  const HANDSHAKE_ICON = '<svg class="partnership-handshake-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8.5 8.5 2-2a2 2 0 0 1 2.8 0l1.1 1.1"/><path d="m7 10 3.2 3.2a1.6 1.6 0 0 0 2.3 0l1.7-1.7"/><path d="m14.2 7.6 1.2-1.2a1.8 1.8 0 0 1 2.5 0L21 9.5"/><path d="m3 10 2-2 2 2-2 2z"/><path d="m21 10-2-2-2 2 2 2z"/><path d="m5 12 5.1 5.1a1.7 1.7 0 0 0 2.4 0l.5-.5"/><path d="m15.8 12.2 2.9 2.9a1.5 1.5 0 0 1-2.1 2.1l-1.4-1.4"/><path d="m13.4 14.6 2.1 2.1a1.5 1.5 0 0 1-2.1 2.1l-2.1-2.1"/><path d="m10.8 16.7 1.4 1.4a1.4 1.4 0 0 1-2 2L7 17"/></svg>';

  let overlay = null;
  let modal = null;
  let toast = null;
  let toastTimer = 0;
  let returnUrl = '';
  let partnerships = [];
  let draft = null;
  let modalView = 'edit';
  let pendingImages = { logo: '', banner: '' };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function getSession() {
    try { return JSON.parse(localStorage.getItem('sed_sessao') || 'null'); } catch { return null; }
  }

  function currentRa() { return String(getSession()?.usuario || '').replace(/\D/g, ''); }
  function isAdmin() { return ADMIN_RAS.has(currentRa()); }

  function adminHeaders(withBody = false) {
    const session = getSession() || {};
    const headers = new Headers({ Accept: 'application/json' });
    if (withBody) headers.set('Content-Type', 'application/json');
    if (session.token2) headers.set('X-Token2', session.token2);
    if (session.token) headers.set('X-Token', session.token);
    if (session.usuario) headers.set('X-Usuario', session.usuario);
    if (session.cdUsuarioCurto) headers.set('X-Cd-Usuario', session.cdUsuarioCurto);
    headers.set('X-Admin-User', currentRa());
    return headers;
  }

  function urlWithoutPartnershipsTab() {
    const params = new URLSearchParams(location.search);
    params.delete(TAB_PARAM);
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  }

  function setNavActive(active) {
    document.querySelectorAll('[data-sedx-partnerships-link]').forEach((link) => {
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function injectNavLink() {
    const rail = document.querySelector('.side-rail .rail-nav');
    if (!rail || rail.querySelector('[data-sedx-partnerships-link]')) return;
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'rail-link sedx-partnerships-nav-link';
    link.dataset.sedxPartnershipsLink = 'true';
    link.setAttribute('aria-label', 'Abrir Parcerias');
    link.innerHTML = `${HANDSHAKE_ICON}<span>Parcerias</span>`;
    const aboutLink = rail.querySelector('a[href="/sobre"]');
    if (aboutLink) rail.insertBefore(link, aboutLink);
    else rail.appendChild(link);
  }

  function showToast(message, kind = 'success') {
    if (toastTimer) window.clearTimeout(toastTimer);
    toast?.remove();
    toast = document.createElement('div');
    toast.className = `partnerships-toast partnerships-toast--${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);
    toastTimer = window.setTimeout(() => { toast?.remove(); toast = null; }, 6500);
  }

  async function apiRequest(path, { method = 'GET', body, admin = false } = {}) {
    const headers = admin ? adminHeaders(body !== undefined) : new Headers({ Accept: 'application/json' });
    const response = await fetch(`${WORKER_URL}${path}`, {
      method,
      headers,
      cache: 'no-store',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || `A operação falhou (HTTP ${response.status}).`);
    return data;
  }

  function normalizePartnership(item) {
    return {
      id: String(item?.id || ''),
      title: String(item?.title || ''),
      description: String(item?.description || ''),
      logo: String(item?.logo || ''),
      banner: String(item?.banner || ''),
      destinationUrl: String(item?.destinationUrl || ''),
      type: String(item?.type || 'Outro'),
      isPublished: item?.isPublished === true || item?.isPublished === 1 || item?.isPublished === '1',
      createdAt: String(item?.createdAt || ''),
      updatedAt: String(item?.updatedAt || ''),
    };
  }

  function validDestination(value) {
    try {
      const url = new URL(String(value || '').trim());
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }

  function renderPartnershipCard(partnership) {
    const published = partnership.isPublished;
    const banner = partnership.banner
      ? `<div class="partnership-card-banner"><img src="${esc(partnership.banner)}" alt="" loading="lazy"></div>`
      : '<div class="partnership-card-banner partnership-card-banner--empty"><span>PARCERIA SEDX</span></div>';
    const logo = partnership.logo
      ? `<img class="partnership-card-logo" src="${esc(partnership.logo)}" alt="Logo de ${esc(partnership.title)}" loading="lazy">`
      : `<div class="partnership-card-logo partnership-card-logo--empty">${HANDSHAKE_ICON}</div>`;
    const type = ALLOWED_TYPES.has(partnership.type) ? partnership.type : 'Outro';
    const link = published && validDestination(partnership.destinationUrl)
      ? `<a class="partnership-visit-button" href="${esc(partnership.destinationUrl)}" target="_blank" rel="noopener noreferrer">Conhecer parceria <span aria-hidden="true">↗</span></a>`
      : '<span class="partnership-draft-note">Rascunho — visível apenas para administradores.</span>';
    const adminActions = isAdmin() ? `<div class="partnership-admin-actions"><button type="button" class="partnership-admin-button" data-partnership-edit="${esc(partnership.id)}">Editar</button><button type="button" class="partnership-admin-button" data-partnership-toggle="${esc(partnership.id)}">${published ? 'Despublicar' : 'Publicar'}</button><button type="button" class="partnership-admin-button partnership-admin-button--danger" data-partnership-delete="${esc(partnership.id)}">Excluir</button></div>` : '';
    return `<article class="partnership-card${published ? '' : ' partnership-card--draft'}" data-partnership-card="${esc(partnership.id)}">${banner}<div class="partnership-card-body">${logo}<div class="partnership-card-meta"><span class="partnership-type-badge partnership-type-badge--${type.toLowerCase()}">${esc(type)}</span>${isAdmin() ? `<span class="partnership-status-badge${published ? ' partnership-status-badge--published' : ''}">${published ? 'Publicada' : 'Rascunho'}</span>` : ''}</div><h2>${esc(partnership.title)}</h2><p class="partnership-card-description">${esc(partnership.description)}</p>${link}${adminActions}</div></article>`;
  }

  function renderList(message = '') {
    const list = overlay?.querySelector('[data-partnerships-list]');
    if (!list) return;
    if (message) {
      list.innerHTML = `<div class="partnerships-empty-state partnerships-empty-state--error"><div class="partnerships-empty-icon">${HANDSHAKE_ICON}</div><div><span class="partnerships-eyebrow">PARCERIAS SEDX</span><h2>Não foi possível carregar as parcerias</h2><p>${esc(message)}</p><button type="button" class="partnerships-secondary-button" data-partnership-retry>Tentar novamente</button></div></div>`;
      return;
    }
    if (!partnerships.length) {
      const text = isAdmin() ? 'Use o botão Publicar para criar a primeira parceria. Ela só ficará visível aos alunos depois da pré-visualização e publicação.' : 'As parcerias publicadas aparecerão aqui.';
      list.innerHTML = `<div class="partnerships-empty-state"><div class="partnerships-empty-icon">${HANDSHAKE_ICON}</div><div><span class="partnerships-eyebrow">PARCERIAS SEDX</span><h2>Nenhuma parceria ${isAdmin() ? 'cadastrada' : 'disponível'} ainda</h2><p>${text}</p></div></div>`;
      return;
    }
    list.innerHTML = `<div class="partnerships-grid">${partnerships.map(renderPartnershipCard).join('')}</div>`;
  }

  async function loadPartnerships() {
    const list = overlay?.querySelector('[data-partnerships-list]');
    if (list) list.innerHTML = '<p class="partnerships-loading" role="status">Carregando parcerias…</p>';
    try {
      const admin = isAdmin();
      const data = await apiRequest(admin ? '/admin/partnerships' : '/partnerships', { admin });
      partnerships = Array.isArray(data.partnerships) ? data.partnerships.map(normalizePartnership) : [];
      renderList();
    } catch (error) {
      renderList(error.message || 'Verifique sua conexão e tente novamente.');
    }
  }

  function renderPage() {
    overlay?.remove();
    overlay = document.createElement('section');
    overlay.className = 'sedx-partnerships-overlay';
    overlay.dataset.sedxPartnershipsOverlay = 'true';
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'Parcerias');
    overlay.innerHTML = `
      <div class="partnerships-page">
        <header class="partnerships-heading">
          <div class="partnerships-heading-title">
            <span class="partnerships-heading-icon">${HANDSHAKE_ICON}</span>
            <div><span class="partnerships-eyebrow">CONEXÕES QUE SOMAM</span><h1>Parcerias</h1><p>Conheça iniciativas e comunidades parceiras do SedX.</p></div>
          </div>
          <div class="partnerships-heading-actions">
            ${isAdmin() ? '<button type="button" class="partnerships-primary-button" data-partnership-publish>＋ Publicar</button>' : ''}
            <button type="button" class="partnerships-close" data-partnership-close aria-label="Fechar Parcerias">×</button>
          </div>
        </header>
        <div data-partnerships-list><p class="partnerships-loading" role="status">Carregando parcerias…</p></div>
      </div>`;
    document.body.appendChild(overlay);
    setNavActive(true);
    overlay.querySelector('[data-partnership-close]')?.focus();
    void loadPartnerships();
  }

  function openPartnerships({ updateHistory = true } = {}) {
    if (!document.querySelector('.app-shell')) return;
    if (overlay?.isConnected) { setNavActive(true); return; }
    const params = new URLSearchParams(location.search);
    if (updateHistory && params.get(TAB_PARAM) !== TAB_VALUE) {
      returnUrl = urlWithoutPartnershipsTab();
      params.set(TAB_PARAM, TAB_VALUE);
      history.pushState({ ...(history.state || {}), sedxPartnershipsTab: true, sedxReturnUrl: returnUrl }, '', `${location.pathname}?${params.toString()}${location.hash}`);
    } else if (!returnUrl) {
      returnUrl = history.state?.sedxReturnUrl || urlWithoutPartnershipsTab();
    }
    renderPage();
  }

  function closePartnerships({ restoreUrl = true } = {}) {
    modal?.remove();
    modal = null;
    draft = null;
    pendingImages = { logo: '', banner: '' };
    overlay?.remove();
    overlay = null;
    setNavActive(false);
    if (restoreUrl && new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) {
      history.replaceState({ ...(history.state || {}), sedxPartnershipsTab: false }, '', returnUrl || urlWithoutPartnershipsTab());
    }
  }

  function createDraft(partnership = null) {
    const base = partnership ? normalizePartnership(partnership) : {
      id: `partnership-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: '', description: '', logo: '', banner: '', destinationUrl: '', type: 'Outro', isPublished: false, createdAt: '', updatedAt: '',
    };
    draft = { ...base };
    pendingImages = { logo: draft.logo, banner: draft.banner };
  }

  function imagePreview(name, value) {
    if (!value) return '';
    const label = name === 'logo' ? 'logo' : 'banner';
    return `<div class="partnership-upload-preview partnership-upload-preview--${label}"><img src="${esc(value)}" alt="Prévia do ${label}"><button type="button" data-partnership-image-remove="${label}">Remover imagem</button></div>`;
  }

  function renderEditor() {
    if (!modal || !draft) return;
    modal.innerHTML = `
      <section class="partnership-modal" role="dialog" aria-modal="true" aria-labelledby="partnership-modal-title">
        <header class="partnership-modal-heading"><div><span class="partnerships-eyebrow">${draft.isPublished ? 'EDIÇÃO DA PARCERIA' : 'NOVA PARCERIA'}</span><h2 id="partnership-modal-title">${draft.isPublished ? 'Editar parceria' : 'Cadastrar parceria'}</h2></div><button type="button" class="partnerships-close" data-partnership-modal-close aria-label="Fechar">×</button></header>
        <form data-partnership-form novalidate>
          <label class="partnership-field">Título <span aria-hidden="true">*</span><input name="title" maxlength="120" required autocomplete="off" value="${esc(draft.title)}" placeholder="Ex.: Comunidade SedX"></label>
          <label class="partnership-field">Descrição <span aria-hidden="true">*</span><textarea name="description" rows="3" maxlength="2000" required placeholder="Apresente a parceria">${esc(draft.description)}</textarea></label>
          <div class="partnership-upload-grid">
            <label class="partnership-field">Logo <small>(opcional)</small><input name="logoFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-partnership-image="logo"><small>Imagem otimizada no navegador, até 250 KB.</small>${imagePreview('logo', pendingImages.logo)}</label>
            <label class="partnership-field">Banner <small>(opcional)</small><input name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-partnership-image="banner"><small>Imagem otimizada no navegador, até 250 KB.</small>${imagePreview('banner', pendingImages.banner)}</label>
          </div>
          <label class="partnership-field">Link de destino <span aria-hidden="true">*</span><input name="destinationUrl" type="url" maxlength="2048" required autocomplete="url" value="${esc(draft.destinationUrl)}" placeholder="https://exemplo.com"></label>
          <label class="partnership-field">Tipo <span aria-hidden="true">*</span><select name="type" required><option value="Discord"${draft.type === 'Discord' ? ' selected' : ''}>Discord</option><option value="WhatsApp"${draft.type === 'WhatsApp' ? ' selected' : ''}>WhatsApp</option><option value="Outro"${draft.type === 'Outro' ? ' selected' : ''}>Outro</option></select></label>
          <p class="partnership-form-error" data-partnership-error role="alert" hidden></p>
          <footer class="partnership-modal-actions"><button type="button" class="partnerships-secondary-button" data-partnership-modal-close>Cancelar</button>${draft.isPublished ? '' : '<button type="button" class="partnerships-secondary-button" data-partnership-save-draft>Salvar rascunho</button>'}<button type="button" class="partnerships-primary-button" data-partnership-preview>Pré-visualizar</button></footer>
        </form>
      </section>`;
    modal.querySelector('[name="title"]')?.focus();
  }

  function renderPreviewCard() {
    const banner = draft.banner
      ? `<div class="partnership-preview-banner"><img src="${esc(draft.banner)}" alt=""></div>`
      : '<div class="partnership-preview-banner partnership-preview-banner--empty"><span>PARCERIA SEDX</span></div>';
    const logo = draft.logo
      ? `<img class="partnership-preview-logo" src="${esc(draft.logo)}" alt="Logo de ${esc(draft.title)}">`
      : `<div class="partnership-preview-logo partnership-preview-logo--empty">${HANDSHAKE_ICON}</div>`;
    const host = (() => { try { return new URL(draft.destinationUrl).host; } catch { return draft.destinationUrl; } })();
    return `<article class="partnership-preview-card">${banner}<div class="partnership-preview-body">${logo}<div class="partnership-card-meta"><span class="partnership-type-badge partnership-type-badge--${draft.type.toLowerCase()}">${esc(draft.type)}</span><span class="partnership-status-badge">Pré-visualização</span></div><h3>${esc(draft.title)}</h3><p>${esc(draft.description)}</p><span class="partnership-visit-button partnership-visit-button--preview">Conhecer parceria <span aria-hidden="true">↗</span></span><small class="partnership-preview-host">${esc(host)}</small></div></article>`;
  }

  function renderPreview() {
    if (!modal || !draft) return;
    const isAlreadyPublished = draft.isPublished;
    modal.innerHTML = `
      <section class="partnership-modal partnership-modal--preview" role="dialog" aria-modal="true" aria-labelledby="partnership-preview-title">
        <header class="partnership-modal-heading"><div><span class="partnerships-eyebrow">REVISÃO ANTES DE PUBLICAR</span><h2 id="partnership-preview-title">Pré-visualização</h2></div><button type="button" class="partnerships-close" data-partnership-modal-close aria-label="Fechar">×</button></header>
        <p class="partnership-preview-notice">Confira como a parceria será exibida${isAlreadyPublished ? ' após salvar as alterações' : ' antes de ficar visível aos alunos'}.</p>
        ${renderPreviewCard()}
        <p class="partnership-form-error" data-partnership-error role="alert" hidden></p>
        <footer class="partnership-modal-actions"><button type="button" class="partnerships-secondary-button" data-partnership-back-edit>Voltar à edição</button>${isAlreadyPublished ? '' : '<button type="button" class="partnerships-secondary-button" data-partnership-save-draft>Salvar rascunho</button>'}<button type="button" class="partnerships-primary-button" data-partnership-publish>${isAlreadyPublished ? 'Salvar alterações' : 'Publicar parceria'}</button></footer>
      </section>`;
  }

  function openEditor(partnership = null, previewFirst = false) {
    if (!isAdmin() || !overlay?.isConnected) return;
    createDraft(partnership);
    modal = document.createElement('div');
    modal.className = 'partnership-modal-backdrop';
    modal.dataset.partnershipModal = 'true';
    document.body.appendChild(modal);
    modalView = previewFirst ? 'preview' : 'edit';
    if (modalView === 'preview') renderPreview(); else renderEditor();
  }

  function showModalError(message) {
    const box = modal?.querySelector('[data-partnership-error]');
    if (!box) { showToast(message, 'error'); return; }
    box.textContent = message;
    box.hidden = false;
  }

  function captureForm() {
    const form = modal?.querySelector('[data-partnership-form]');
    if (!form || !draft) return false;
    const values = new FormData(form);
    draft.title = String(values.get('title') || '').trim();
    draft.description = String(values.get('description') || '').trim();
    draft.destinationUrl = String(values.get('destinationUrl') || '').trim();
    draft.type = String(values.get('type') || '');
    draft.logo = pendingImages.logo;
    draft.banner = pendingImages.banner;
    return true;
  }

  function validateDraft() {
    if (!draft.title) return 'Informe o título da parceria.';
    if (draft.title.length > 120) return 'O título deve ter no máximo 120 caracteres.';
    if (!draft.description) return 'Informe a descrição da parceria.';
    if (draft.description.length > 2000) return 'A descrição deve ter no máximo 2.000 caracteres.';
    if (!validDestination(draft.destinationUrl)) return 'Informe um link de destino válido, começando com http:// ou https://.';
    if (draft.destinationUrl.length > 2048) return 'O link de destino é muito longo.';
    if (!ALLOWED_TYPES.has(draft.type)) return 'Selecione Discord, WhatsApp ou Outro.';
    for (const name of ['logo', 'banner']) {
      if (draft[name].length > MAX_IMAGE_DATA_LENGTH) return 'Uma das imagens excede o limite permitido de 250 KB.';
      if (draft[name] && !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(draft[name])) return 'Uma das imagens selecionadas não é válida.';
    }
    return '';
  }

  async function imageToDataUrl(file) {
    if (!file || !/^image\/(?:png|jpeg|webp|gif)$/i.test(file.type)) throw new Error('Selecione um arquivo PNG, JPEG, WebP ou GIF.');
    let blob;
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      let scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) { bitmap.close?.(); throw new Error('Não foi possível processar a imagem neste navegador.'); }
      for (let attempt = 0; attempt < 10; attempt += 1) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const quality = Math.max(.38, .84 - attempt * .055);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size <= MAX_IMAGE_BYTES) break;
        if (attempt >= 3) scale *= .82;
      }
      bitmap.close?.();
    } else {
      if (file.size > MAX_IMAGE_BYTES) throw new Error('Este navegador não consegue reduzir a imagem. Selecione um arquivo de até 250 KB.');
      blob = file;
    }
    if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('A imagem ficou maior que 250 KB após a otimização. Escolha outra imagem.');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
      reader.readAsDataURL(blob);
    });
  }

  async function savePartnership(isPublished) {
    if (!isAdmin() || !draft) return;
    const error = validateDraft();
    if (error) { showModalError(error); return; }
    const button = modal?.querySelector(isPublished ? '[data-partnership-publish]' : '[data-partnership-save-draft]');
    const originalLabel = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = isPublished ? 'Publicando…' : 'Salvando…'; }
    const wasPublished = draft.isPublished;
    const payload = { ...draft, isPublished: Boolean(isPublished) };
    try {
      await apiRequest('/admin/partnerships', { method: 'POST', body: payload, admin: true });
      const successMessage = isPublished
        ? (wasPublished ? 'Alterações salvas e parceria atualizada com sucesso.' : 'Parceria publicada com sucesso.')
        : 'Rascunho salvo com sucesso.';
      modal?.remove();
      modal = null;
      draft = null;
      pendingImages = { logo: '', banner: '' };
      showToast(successMessage);
      await loadPartnerships();
    } catch (error) {
      showModalError(error.message || 'Não foi possível salvar a parceria. Tente novamente.');
      if (button) { button.disabled = false; button.textContent = originalLabel; }
    }
  }

  async function setPublished(partnership, isPublished) {
    if (!isAdmin()) return;
    try {
      await apiRequest('/admin/partnerships/status', { method: 'PUT', body: { id: partnership.id, isPublished }, admin: true });
      showToast(isPublished ? 'Parceria publicada com sucesso.' : 'Parceria despublicada com sucesso.');
      await loadPartnerships();
    } catch (error) {
      showToast(error.message || 'Não foi possível alterar o status da parceria.', 'error');
    }
  }

  async function deletePartnership(partnership) {
    if (!isAdmin()) return;
    const confirmed = window.confirm(`Excluir a parceria “${partnership.title}”? Essa ação não pode ser desfeita.`);
    if (!confirmed) return;
    try {
      await apiRequest(`/admin/partnerships?id=${encodeURIComponent(partnership.id)}`, { method: 'DELETE', admin: true });
      showToast('Parceria excluída com sucesso.');
      await loadPartnerships();
    } catch (error) {
      showToast(error.message || 'Não foi possível excluir a parceria.', 'error');
    }
  }

  function showPreview() {
    if (!captureForm()) return;
    const error = validateDraft();
    if (error) { showModalError(error); return; }
    modalView = 'preview';
    renderPreview();
  }

  document.addEventListener('click', (event) => {
    const navLink = event.target.closest('[data-sedx-partnerships-link]');
    if (navLink) { event.preventDefault(); openPartnerships(); return; }
    if (overlay && event.target.closest('[data-partnership-close]')) { closePartnerships(); return; }
    const pagePublishButton = overlay && event.target.closest('[data-partnership-publish]');
    if (pagePublishButton && overlay.contains(pagePublishButton)) { openEditor(); return; }
    if (modal && (event.target.closest('[data-partnership-modal-close]') || event.target === modal)) { modal.remove(); modal = null; draft = null; pendingImages = { logo: '', banner: '' }; return; }
    if (modal && event.target.closest('[data-partnership-preview]')) { showPreview(); return; }
    if (modal && event.target.closest('[data-partnership-back-edit]')) { modalView = 'edit'; renderEditor(); return; }
    if (modal && event.target.closest('[data-partnership-save-draft]')) { if (modalView === 'edit') captureForm(); void savePartnership(false); return; }
    if (modal && event.target.closest('[data-partnership-publish]')) { void savePartnership(true); return; }
    const imageRemove = modal && event.target.closest('[data-partnership-image-remove]');
    if (imageRemove) {
      captureForm();
      const name = imageRemove.dataset.partnershipImageRemove;
      if (name === 'logo' || name === 'banner') {
        pendingImages[name] = '';
        draft[name] = '';
        renderEditor();
      }
      return;
    }
    if (overlay && event.target.closest('[data-partnership-retry]')) { void loadPartnerships(); return; }
    const editButton = overlay && event.target.closest('[data-partnership-edit]');
    if (editButton) { openEditor(partnerships.find((item) => item.id === editButton.dataset.partnershipEdit)); return; }
    const toggleButton = overlay && event.target.closest('[data-partnership-toggle]');
    if (toggleButton) {
      const item = partnerships.find((partnership) => partnership.id === toggleButton.dataset.partnershipToggle);
      if (item) { if (item.isPublished) void setPublished(item, false); else openEditor(item, true); }
      return;
    }
    const deleteButton = overlay && event.target.closest('[data-partnership-delete]');
    if (deleteButton) {
      const item = partnerships.find((partnership) => partnership.id === deleteButton.dataset.partnershipDelete);
      if (item) void deletePartnership(item);
      return;
    }
    const otherNav = event.target.closest('.rail-nav .rail-link');
    if (overlay && otherNav) closePartnerships();
  });

  document.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-partnership-image]');
    if (!modal || !input) return;
    const name = input.dataset.partnershipImage;
    const file = input.files?.[0];
    if (!file || (name !== 'logo' && name !== 'banner')) return;
    captureForm();
    input.disabled = true;
    try {
      const image = await imageToDataUrl(file);
      pendingImages[name] = image;
      draft[name] = image;
      renderEditor();
      const updatedPreview = modal?.querySelector(`[data-partnership-image-remove="${name}"]`);
      updatedPreview?.focus();
    } catch (error) {
      input.value = '';
      showModalError(error.message || 'Não foi possível processar a imagem.');
      input.disabled = false;
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.matches('[data-partnership-form]')) {
      event.preventDefault();
      showPreview();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (modal) { modal.remove(); modal = null; draft = null; pendingImages = { logo: '', banner: '' }; }
    else if (overlay) closePartnerships();
  });

  window.addEventListener('popstate', () => {
    if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) openPartnerships({ updateHistory: false });
    else closePartnerships({ restoreUrl: false });
  });

  function boot() {
    injectNavLink();
    if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) openPartnerships({ updateHistory: false });
    const observer = new MutationObserver(() => {
      injectNavLink();
      if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE && !overlay?.isConnected) openPartnerships({ updateHistory: false });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

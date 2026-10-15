(() => {
  "use strict";

  const MAX_UPLOAD_BYTES = 450_000;
  const ADMIN_RAS = new Set(["1127241606", "1127620514"]);
  function isAdminCandidate() {
    try {
      const session = JSON.parse(localStorage.getItem("sed_sessao") || "null");
      return ADMIN_RAS.has(String(session?.usuario || "").replace(/\D/g, ""));
    } catch { return false; }
  }
  const navOrderObserver = new MutationObserver(() => {
    const rail = document.querySelector(".side-rail .rail-nav");
    const aboutLink = rail?.querySelector('a[href="/sobre"]');
    if (aboutLink && rail.lastElementChild !== aboutLink) rail.appendChild(aboutLink);
  });
  navOrderObserver.observe(document.documentElement, { childList: true, subtree: true });
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const safeUrl = (value) => {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch { return ""; }
  };
  const emptySection = () => ({ id: `section-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, title: "Nova seção", text: "", icon: "✦", image: "", links: [], buttons: [] });

  function renderLinks(items, className) {
    if (!Array.isArray(items)) return "";
    return items.map((item) => {
      const href = safeUrl(item?.url);
      if (!href || !item?.label) return "";
      return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}<span aria-hidden="true">↗</span></a>`;
    }).join("");
  }

  function renderContent(content) {
    if (!content) return "";
    const sections = Array.isArray(content.sections) ? content.sections : [];
    return `<div class="about-public-content">
      <div class="about-intro"><span class="eyebrow">CONHEÇA O SEDX</span><h2>${escapeHtml(content.title || "Sobre o SEDX")}</h2><p>${escapeHtml(content.intro || "")}</p></div>
      <div class="about-card-grid">${sections.map((section, index) => {
        const image = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(section?.image || "") ? section.image : "";
        return `<article class="about-card" style="--about-delay:${Math.min(index, 8) * 45}ms">
          <div class="about-card-icon" aria-hidden="true">${escapeHtml(section.icon || "✦")}</div>
          ${image ? `<img class="about-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(section.title || "Imagem da seção")}" loading="lazy">` : ""}
          <h3>${escapeHtml(section.title || "")}</h3><p>${escapeHtml(section.text || "")}</p>
          <div class="about-card-links">${renderLinks(section.links, "about-text-link")}${renderLinks(section.buttons, "about-link-button")}</div>
        </article>`;
      }).join("")}</div>
    </div>`;
  }

  function renderLinkEditor(sectionIndex, kind, items) {
    const label = kind === "links" ? "Links" : "Botões";
    return `<div class="about-link-editor"><div class="about-field-title"><strong>${label}</strong><button type="button" class="about-quiet-button" data-action="add-link" data-index="${sectionIndex}" data-kind="${kind}">+ Adicionar</button></div>
      ${(items || []).map((item, linkIndex) => `<div class="about-link-row">
        <label><span>Texto</span><input data-field="link" data-index="${sectionIndex}" data-kind="${kind}" data-link="${linkIndex}" data-key="label" value="${escapeHtml(item.label || "")}" maxlength="60"></label>
        <label><span>URL (http/https)</span><input data-field="link" data-index="${sectionIndex}" data-kind="${kind}" data-link="${linkIndex}" data-key="url" value="${escapeHtml(item.url || "")}" inputmode="url" maxlength="2048"></label>
        <button type="button" class="about-icon-button" aria-label="Remover ${label.toLowerCase()}" data-action="remove-link" data-index="${sectionIndex}" data-kind="${kind}" data-link="${linkIndex}">×</button>
      </div>`).join("") || `<p class="about-muted">Nenhum ${kind === "links" ? "link" : "botão"} adicionado.</p>`}</div>`;
  }

  function renderEditor(state) {
    const draft = state.draft || { title: "Sobre o SEDX", intro: "", sections: [] };
    const sections = Array.isArray(draft.sections) ? draft.sections : [];
    return `<section class="about-editor" aria-label="Editor da página Sobre">
      <div class="about-editor-heading"><div><span class="eyebrow">ÁREA ADMINISTRATIVA</span><h2>Editor da página Sobre</h2><p>Rascunhos ficam privados até serem publicados.</p></div><span class="about-admin-badge">Administrador verificado</span></div>
      ${state.notice ? `<div class="about-notice ${state.noticeType === "error" ? "is-error" : ""}" role="status">${escapeHtml(state.notice)}</div>` : ""}
      <div class="about-editor-layout">
        <div class="about-editor-fields">
          <label class="about-field"><span>Título</span><input data-field="title" value="${escapeHtml(draft.title || "")}" maxlength="120"></label>
          <label class="about-field"><span>Introdução</span><textarea data-field="intro" rows="3" maxlength="1000">${escapeHtml(draft.intro || "")}</textarea></label>
          <div class="about-sections-heading"><h3>Seções</h3><button type="button" class="about-secondary-button" data-action="add-section">+ Adicionar seção</button></div>
          ${sections.map((section, index) => `<article class="about-edit-section">
            <div class="about-edit-section-head"><strong>Seção ${index + 1}</strong><div class="about-section-tools">
              <button type="button" class="about-icon-button" aria-label="Mover seção para cima" data-action="move-section" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
              <button type="button" class="about-icon-button" aria-label="Mover seção para baixo" data-action="move-section" data-index="${index}" data-direction="1" ${index === sections.length - 1 ? "disabled" : ""}>↓</button>
              <button type="button" class="about-icon-button is-danger" aria-label="Excluir seção" data-action="remove-section" data-index="${index}">×</button>
            </div></div>
            <label class="about-field"><span>Título da seção</span><input data-field="section" data-index="${index}" data-key="title" value="${escapeHtml(section.title || "")}" maxlength="120"></label>
            <label class="about-field"><span>Texto</span><textarea data-field="section" data-index="${index}" data-key="text" rows="4" maxlength="3000">${escapeHtml(section.text || "")}</textarea></label>
            <label class="about-field"><span>Ícone ou emoji</span><input data-field="section" data-index="${index}" data-key="icon" value="${escapeHtml(section.icon || "")}" maxlength="32" placeholder="Ex.: ✦, 📚, ♡"></label>
            <label class="about-field"><span>Imagem (PNG, JPEG ou WebP; até 450 KB)</span><input type="file" accept="image/png,image/jpeg,image/webp" data-action="upload-image" data-index="${index}"></label>
            ${section.image ? `<div class="about-upload-preview"><img src="${escapeHtml(section.image)}" alt="Prévia da imagem"><button type="button" class="about-quiet-button" data-action="remove-image" data-index="${index}">Remover imagem</button></div>` : ""}
            ${renderLinkEditor(index, "links", section.links)}${renderLinkEditor(index, "buttons", section.buttons)}
          </article>`).join("")}
        </div>
        <aside class="about-preview-panel"><div class="about-preview-toolbar"><strong>Pré-visualização</strong><div class="about-preview-switch"><button type="button" class="${state.previewMode === "mobile" ? "is-active" : ""}" data-action="preview-mode" data-mode="mobile">Celular</button><button type="button" class="${state.previewMode === "desktop" ? "is-active" : ""}" data-action="preview-mode" data-mode="desktop">Computador</button></div></div>
          <div class="about-preview-frame ${state.previewMode === "mobile" ? "is-mobile" : "is-desktop"}" data-preview-content>${renderContent(draft)}</div>
        </aside>
      </div>
      <div class="about-editor-footer"><div class="about-version-tools"><label><span>Versões publicadas</span><select data-role="version-select"><option value="">Escolha uma versão</option>${(state.versions || []).map((version) => `<option value="${escapeHtml(version.id)}" ${state.selectedVersion === version.id ? "selected" : ""}>${escapeHtml(version.title)} — ${escapeHtml(new Date(version.publishedAt).toLocaleString("pt-BR"))}</option>`).join("")}</select></label><button type="button" class="about-secondary-button" data-action="restore-version" ${state.busy ? "disabled" : ""}>Restaurar para rascunho</button></div>
        <div class="about-publish-actions"><button type="button" class="about-secondary-button" data-action="save-draft" ${state.busy ? "disabled" : ""}>Salvar rascunho</button>${state.publicData?.published ? `<button type="button" class="about-secondary-button is-danger" data-action="unpublish" ${state.busy ? "disabled" : ""}>Despublicar</button>` : ""}<button type="button" class="about-primary-button" data-action="publish" ${state.busy ? "disabled" : ""}>${state.busy ? "Salvando…" : "Publicar agora"}</button></div>
      </div>
    </section>`;
  }

  function mount(root, { request } = {}) {
    if (!root || typeof request !== "function") return () => {};
    const state = { publicData: null, isAdmin: false, adminCandidate: isAdminCandidate(), draft: null, versions: [], editorOpen: false, previewMode: "desktop", notice: "", noticeType: "", busy: false, selectedVersion: "", loadError: "" };
    let disposed = false;
    const api = (path, method = "GET", body) => request(path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });

    function renderPage() {
      if (disposed) return;
      const content = state.publicData?.published ? state.publicData.content : null;
      root.innerHTML = `<div class="page-stack about-page">
        <header class="page-heading about-page-heading"><div><span class="eyebrow">CONHEÇA O SEDX</span><h1>Sobre</h1><p>Conheça a proposta e as ferramentas do SEDX.</p></div>${state.isAdmin || state.adminCandidate ? `<button type="button" class="about-primary-button" data-action="toggle-editor">${state.editorOpen ? "Fechar editor" : "Publicar Sobre"}</button>` : ""}</header>
        ${state.loadError ? `<div class="about-notice is-error" role="alert">${escapeHtml(state.loadError)}</div>` : ""}
        ${state.adminCandidate && !state.isAdmin && state.notice && !state.editorOpen ? `<div class="about-notice is-error" role="alert">${escapeHtml(state.notice)}</div>` : ""}
        ${content ? renderContent(content) : `<section class="about-unpublished"><span class="about-card-icon" aria-hidden="true">✦</span><h2>Sobre o SEDX</h2><p>${state.isAdmin ? "Ainda não há uma versão publicada. Abra o editor para preparar o conteúdo." : "As informações desta página ainda não foram publicadas."}</p></section>`}
        ${state.isAdmin && state.editorOpen ? renderEditor(state) : ""}
      </div>`;
    }

    function updatePreview() {
      const preview = root.querySelector("[data-preview-content]");
      if (preview) preview.innerHTML = renderContent(state.draft);
    }

    async function refreshPublic() {
      state.publicData = await api("/about");
    }

    async function initialize() {
      root.innerHTML = `<div class="about-loading" role="status">Carregando a página Sobre…</div>`;
      try { await refreshPublic(); }
      catch { state.loadError = "Não foi possível carregar a página Sobre agora."; }
      try {
        const admin = await api("/admin/about");
        state.isAdmin = admin?.isAdmin === true;
        if (state.isAdmin) {
          state.draft = admin.draft || { title: "Sobre o SEDX", intro: "", sections: [] };
          state.versions = Array.isArray(admin.versions) ? admin.versions : [];
        }
      } catch { state.isAdmin = false; }
      if (!state.draft) state.draft = { title: "Sobre o SEDX", intro: "", sections: [] };
      if (!Array.isArray(state.draft.sections)) state.draft.sections = [];
      state.draft.sections = state.draft.sections.map((section) => ({ links: [], buttons: [], ...section }));
      renderPage();
    }

    async function withBusy(action) {
      if (state.busy) return;
      state.busy = true; state.notice = ""; state.noticeType = ""; renderPage();
      try { await action(); }
      catch (error) { state.notice = error?.message || "Não foi possível concluir a operação."; state.noticeType = "error"; }
      finally { state.busy = false; renderPage(); }
    }

    function onInput(event) {
      const target = event.target;
      const field = target?.dataset?.field;
      if (!field || !state.draft) return;
      const index = Number(target.dataset.index);
      if (field === "title") state.draft.title = target.value;
      else if (field === "intro") state.draft.intro = target.value;
      else if (field === "section" && state.draft.sections[index]) state.draft.sections[index][target.dataset.key] = target.value;
      else if (field === "link" && state.draft.sections[index]) {
        const list = state.draft.sections[index][target.dataset.kind];
        if (list?.[Number(target.dataset.link)]) list[Number(target.dataset.link)][target.dataset.key] = target.value;
      }
      updatePreview();
    }

    function onChange(event) {
      const input = event.target;
      if (input?.dataset?.role === "version-select") { state.selectedVersion = input.value; return; }
      if (input?.dataset?.action !== "upload-image") return;
      const file = input.files?.[0];
      const index = Number(input.dataset.index);
      if (!file || !state.draft.sections[index]) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_UPLOAD_BYTES) {
        state.notice = "Use uma imagem PNG, JPEG ou WebP de até 450 KB."; state.noticeType = "error"; renderPage(); return;
      }
      const reader = new FileReader();
      reader.onload = () => { state.draft.sections[index].image = String(reader.result || ""); state.notice = "Imagem adicionada ao rascunho."; state.noticeType = ""; renderPage(); };
      reader.onerror = () => { state.notice = "Não foi possível ler essa imagem."; state.noticeType = "error"; renderPage(); };
      reader.readAsDataURL(file);
    }

    async function onClick(event) {
      const button = event.target.closest("[data-action]");
      if (!button || !root.contains(button)) return;
      const action = button.dataset.action;
      const index = Number(button.dataset.index);
      const section = state.draft.sections?.[index];
      if (action === "toggle-editor" && state.isAdmin) { state.editorOpen = !state.editorOpen; state.notice = ""; renderPage(); return; }
      if (action === "toggle-editor" && state.adminCandidate && !state.isAdmin) {
        await withBusy(async () => {
          const admin = await api("/admin/about");
          if (admin?.isAdmin !== true) throw new Error("O servidor ainda não confirmou a permissão. Atualize sua sessão e tente novamente.");
          state.isAdmin = true;
          state.draft = admin.draft || { title: "Sobre o SEDX", intro: "", sections: [] };
          state.draft.sections = Array.isArray(state.draft.sections) ? state.draft.sections.map((section) => ({ links: [], buttons: [], ...section })) : [];
          state.versions = Array.isArray(admin.versions) ? admin.versions : [];
          state.editorOpen = true;
        });
        return;
      }
      if (action === "preview-mode") { state.previewMode = button.dataset.mode === "mobile" ? "mobile" : "desktop"; renderPage(); return; }
      if (action === "add-section") { state.draft.sections.push(emptySection()); renderPage(); return; }
      if (action === "remove-section" && section) { state.draft.sections.splice(index, 1); renderPage(); return; }
      if (action === "move-section" && section) {
        const next = index + Number(button.dataset.direction);
        if (next >= 0 && next < state.draft.sections.length) { [state.draft.sections[index], state.draft.sections[next]] = [state.draft.sections[next], state.draft.sections[index]]; renderPage(); }
        return;
      }
      if (action === "add-link" && section) { section[button.dataset.kind] ||= []; section[button.dataset.kind].push({ label: "", url: "" }); renderPage(); return; }
      if (action === "remove-link" && section) { section[button.dataset.kind].splice(Number(button.dataset.link), 1); renderPage(); return; }
      if (action === "remove-image" && section) { section.image = ""; renderPage(); return; }
      if (action === "save-draft") {
        await withBusy(async () => { const result = await api("/admin/about/draft", "PUT", state.draft); state.draft = result.draft; state.notice = "Rascunho salvo. A página pública não foi alterada."; });
        return;
      }
      if (action === "publish") {
        await withBusy(async () => {
          const saved = await api("/admin/about/draft", "PUT", state.draft); state.draft = saved.draft;
          const result = await api("/admin/about/publish", "POST", {});
          state.versions = result.versions || state.versions;
          await refreshPublic();
          state.notice = "Página Sobre publicada com sucesso.";
        });
        return;
      }
      if (action === "unpublish") {
        if (!window.confirm("Despublicar a página Sobre? A versão atual continuará disponível no histórico.")) return;
        await withBusy(async () => { await api("/admin/about/unpublish", "POST", {}); await refreshPublic(); state.notice = "A página foi despublicada. As versões anteriores continuam salvas."; });
        return;
      }
      if (action === "restore-version") {
        if (!state.selectedVersion) { state.notice = "Escolha uma versão para restaurar."; state.noticeType = "error"; renderPage(); return; }
        await withBusy(async () => { const result = await api("/admin/about/restore", "POST", { versionId: state.selectedVersion }); state.draft = result.draft; state.notice = "Versão restaurada como rascunho; publique para torná-la pública."; state.noticeType = ""; });
      }
    }

    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("click", onClick);
    void initialize();
    return () => { disposed = true; root.removeEventListener("input", onInput); root.removeEventListener("change", onChange); root.removeEventListener("click", onClick); };
  }

  window.SedxAboutPage = { mount };
})();

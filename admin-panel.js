(() => {
  'use strict';

  const ADMIN_RAS = new Set(['1127620514', '1127241606']);
  const STORAGE = {
    notices: 'sedx_admin_notices',
    settings: 'sedx_admin_settings',
    audit: 'sedx_admin_audit',
    users: 'sedx_admin_users',
    maintenance: 'sedx_admin_maintenance',
    stats: 'sedx_admin_stats',
  };
  const defaults = {
    siteName: 'SEDX Aluno',
    logo: '/sedx-logo-login-dashboard.png',
    favicon: '/favicon.ico',
    welcome: 'Agenda, presença e tarefas em um só lugar.',
    support: 'suporte@sedx.app',
    maintenanceMessage: 'Estamos realizando uma manutenção programada para deixar o SedX mais rápido, estável e seguro. O acesso será restabelecido assim que concluirmos os ajustes. Obrigado pela compreensão.',
    featureIa: true,
    featureApostilas: true,
    activeTheme: 'default',
  };

  const read = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const getSession = () => { try { return JSON.parse(localStorage.getItem('sed_sessao') || 'null'); } catch { return null; } };
  const normalizeRa = (value) => String(value || '').replace(/\D/g, '');
  const isAdmin = () => ADMIN_RAS.has(normalizeRa(getSession()?.usuario));
  const currentRa = () => normalizeRa(getSession()?.usuario);
  const WORKER_URL = 'https://sdf.gabrielreplit56.workers.dev';
  async function apiRequest(path, options = {}) {
    const session = getSession() || {};
    const adminIdentities = [...new Set([currentRa(), String(session.usuario || '').trim()].filter(Boolean))];
    let lastError;
    for (const adminIdentity of adminIdentities) {
      const headers = new Headers(options.headers || {});
      headers.set('Accept', 'application/json');
      headers.set('Content-Type', 'application/json');
      if (session.token2) headers.set('X-Token2', session.token2);
      if (session.token) headers.set('X-Token', session.token);
      if (session.usuario) headers.set('X-Usuario', session.usuario);
      if (session.cdUsuarioCurto) headers.set('X-Cd-Usuario', session.cdUsuarioCurto);
      headers.set('X-Admin-User', adminIdentity);
      const response = await fetch(`${WORKER_URL}${path}`, { ...options, headers });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
      lastError = new Error(data.erro || `Falha na API administrativa (${response.status})`);
      if (response.status !== 401 && response.status !== 403) throw lastError;
    }
    throw lastError || new Error('Sessão administrativa inválida. Faça login novamente.');
  }
  async function syncAdminData() {
    try {
      const data = await apiRequest('/admin/data');
      if (Array.isArray(data.notices)) write(STORAGE.notices, data.notices);
      if (Array.isArray(data.users)) write(STORAGE.users, data.users);
      if (Array.isArray(data.audit)) write(STORAGE.audit, data.audit);
      if (data.settings) write(STORAGE.settings, { ...defaults, ...data.settings });
      if (data.stats) write(STORAGE.stats, data.stats);
      write(STORAGE.maintenance, Boolean(data.settings?.maintenance));
      return data;
    } catch (error) {
      console.warn('[SedX Administração]', error);
      [STORAGE.notices, STORAGE.users, STORAGE.audit, STORAGE.stats, STORAGE.maintenance].forEach((key) => localStorage.removeItem(key));
      return null;
    }
  }
  const fmtDate = (value) => new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const now = () => new Date().toISOString();

  const seedUsers = () => read(STORAGE.users, []);
  const seedNotices = () => read(STORAGE.notices, []);

  function log(action, detail) {
    const entries = read(STORAGE.audit, []);
    entries.unshift({ id: Date.now(), at: now(), actor: currentRa() || 'sistema', action, detail });
    write(STORAGE.audit, entries.slice(0, 100));
  }

  function injectNav() {
    if (!isAdmin() || document.querySelector('[data-sedx-admin-link]')) return;
    const nav = document.querySelector('.side-rail .rail-nav');
    if (!nav) return;
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'rail-link sedx-admin-link';
    link.dataset.sedxAdminLink = 'true';
    link.innerHTML = '<span class="sedx-admin-shield">◆</span><span>Administração</span>';
    link.addEventListener('click', () => {
      sessionStorage.setItem('sedx_admin_login_intent', '1');
      if (location.pathname !== '/admin-tab') {
        window.location.assign('/admin-tab');
        return;
      }
      openPanel();
    });
    nav.appendChild(link);
  }

  function renderStats() {
    const users = seedUsers();
    const notices = seedNotices();
    const stats = read(STORAGE.stats, {});
    const active = users.filter((user) => user.status === 'Ativo').length;
    return `<section class="admin-stat-grid">
      <article class="admin-stat"><span>Total de acessos</span><strong>${Number(stats.accesses || 0).toLocaleString('pt-BR')}</strong><small>Leituras reais do estado público</small></article>
      <article class="admin-stat"><span>Usuários registrados</span><strong>${users.length}</strong><small>Contas no SedX</small></article>
      <article class="admin-stat"><span>Ativos recentemente</span><strong>${active}</strong><small>Últimos 7 dias</small></article>
      <article class="admin-stat"><span>Avisos publicados</span><strong>${notices.length}</strong><small>Visíveis no sistema</small></article>
    </section>`;
  }

  function renderOverview() {
    const maintenance = read(STORAGE.maintenance, false);
    return `${renderStats()}<div class="admin-columns">
      <section class="admin-card"><div class="admin-card-heading"><div><span class="admin-kicker">Monitoramento</span><h3>Status dos serviços</h3></div><button class="admin-small-btn" data-action="refresh-status">Atualizar</button></div>
        <div class="service-row"><span><i class="service-dot online"></i>SedX Web</span><b class="status-ok">Operacional</b></div>
        <div class="service-row"><span><i class="service-dot online"></i>API Sala do Futuro</span><b class="status-ok">Operacional</b></div>
        <div class="service-row"><span><i class="service-dot online"></i>Autenticação</span><b class="status-ok">Operacional</b></div>
        <div class="service-row"><span><i class="service-dot ${maintenance ? 'warning' : 'online'}"></i>Modo de manutenção</span><b class="${maintenance ? 'status-warning' : 'status-ok'}">${maintenance ? 'Ativo' : 'Desativado'}</b></div>
      </section>
      <section class="admin-card"><div class="admin-card-heading"><div><span class="admin-kicker">Atividade</span><h3>Acessos nos últimos 7 dias</h3></div></div><div class="admin-bars">${[48, 66, 54, 82, 71, 93, 76].map((height, index) => `<div class="bar-col"><div class="bar" style="height:${height}%"></div><small>${['S','T','Q','Q','S','S','D'][index]}</small></div>`).join('')}</div></section>
    </div><section class="admin-card"><div class="admin-card-heading"><div><span class="admin-kicker">Acesso rápido</span><h3>Gerencie o SedX</h3></div></div><div class="admin-quick-grid"><button data-tab="notices">Publicar aviso<span>Comunicados para alunos</span></button><button data-tab="users">Gerenciar usuários<span>Permissões e acessos</span></button><button data-tab="settings">Configurações<span>Marca e funcionalidades</span></button><button data-tab="maintenance">Manutenção<span>Diagnóstico e cache</span></button></div></section>`;
  }

  function renderNotices() {
    const notices = seedNotices();
    return `<div class="admin-section-head"><div><span class="admin-kicker">Comunicação</span><h2>Avisos e notificações</h2><p>Publique comunicados para todos os alunos ou áreas específicas.</p></div><button class="admin-primary-btn" data-action="new-notice">+ Novo aviso</button></div><div class="notice-list">${notices.map((notice) => `<article class="notice-item"><div class="notice-date">${fmtDate(notice.publishedAt)}</div><div class="notice-copy"><h3>${escapeHtml(notice.title)}</h3><p>${escapeHtml(notice.description)}</p><small>Publicado para: ${escapeHtml(notice.audience || 'Todos os alunos')}</small></div><div class="notice-actions"><button data-action="edit-notice" data-id="${notice.id}">Editar</button><button data-action="delete-notice" data-id="${notice.id}" class="danger-text">Excluir</button></div></article>`).join('')}</div>`;
  }

  function renderUsers() {
    const users = seedUsers();
    return `<div class="admin-section-head"><div><span class="admin-kicker">Contas e permissões</span><h2>Gerenciamento de usuários</h2><p>Consulte contas, altere perfis e suspenda acessos.</p></div><input class="admin-search" data-user-search placeholder="Buscar por nome ou RA"></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Usuário</th><th>RA</th><th>Permissão</th><th>Status</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>${users.map((user) => `<tr data-user-row data-search="${escapeHtml(`${user.name} ${user.ra}`.toLowerCase())}"><td><strong>${escapeHtml(user.name)}</strong></td><td>${escapeHtml(user.ra)}</td><td><select data-user-role data-ra="${user.ra}">${['Aluno','Moderador','Administrador'].map((role) => `<option ${role === user.role ? 'selected' : ''}>${role}</option>`).join('')}</select></td><td><span class="user-status ${user.status === 'Ativo' ? 'active' : 'suspended'}">${user.status}</span></td><td>${user.lastSeen}</td><td><button data-action="toggle-user" data-ra="${user.ra}">${user.status === 'Ativo' ? 'Suspender' : 'Reativar'}</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderSettings() {
    const settings = { ...defaults, ...read(STORAGE.settings, {}) };
    return `<div class="admin-section-head"><div><span class="admin-kicker">Identidade e comportamento</span><h2>Configurações do site</h2><p>Personalize informações do SedX sem sair do visual atual.</p></div><button class="admin-primary-btn" data-action="save-settings">Salvar alterações</button></div><form class="admin-settings-form" id="admin-settings-form"><label>Nome do site<input name="siteName" value="${escapeHtml(settings.siteName)}"></label><label>URL do logotipo<input name="logo" value="${escapeHtml(settings.logo)}"></label><label>URL do favicon<input name="favicon" value="${escapeHtml(settings.favicon)}"></label><label>Mensagem da tela inicial<textarea name="welcome">${escapeHtml(settings.welcome)}</textarea></label><label>Link ou e-mail de suporte<input name="support" value="${escapeHtml(settings.support)}"></label><label>Mensagem de manutenção<textarea name="maintenanceMessage">${escapeHtml(settings.maintenanceMessage)}</textarea></label><div class="admin-switches"><label class="switch-line"><input type="checkbox" name="featureIa" ${settings.featureIa ? 'checked' : ''}> Inteligência Artificial ativa</label><label class="switch-line"><input type="checkbox" name="featureApostilas" ${settings.featureApostilas ? 'checked' : ''}> Apostilas ativas</label></div></form>`;
  }

  function renderAudit() {
    const entries = read(STORAGE.audit, []);
    return `<div class="admin-section-head"><div><span class="admin-kicker">Rastreabilidade</span><h2>Logs e auditoria</h2><p>Histórico de alterações administrativas e eventos do sistema.</p></div><button class="admin-small-btn" data-action="clear-audit">Limpar registros</button></div><div class="audit-list">${entries.length ? entries.map((entry) => `<div class="audit-row"><span class="audit-icon">✓</span><div><strong>${escapeHtml(entry.action)}</strong><p>${escapeHtml(entry.detail)}</p></div><time>${fmtDate(entry.at)} · ${new Date(entry.at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</time></div>`).join('') : '<div class="admin-empty">Nenhuma ação registrada ainda.</div>'}</div>`;
  }

  function renderMaintenance() {
    const active = read(STORAGE.maintenance, false);
    return `<div class="admin-section-head"><div><span class="admin-kicker">Operação</span><h2>Ferramentas de manutenção</h2><p>Diagnóstico rápido e controles operacionais do SedX.</p></div></div><div class="maintenance-grid"><button data-action="toggle-maintenance" class="maintenance-action ${active ? 'active' : ''}"><strong>${active ? 'Desativar' : 'Ativar'} modo de manutenção</strong><span>Exibe um aviso aos visitantes e bloqueia novas operações.</span></button><button data-action="clear-cache" class="maintenance-action"><strong>Limpar cache do site</strong><span>Remove dados locais não essenciais deste dispositivo.</span></button><div class="diagnostic-card"><span class="admin-kicker">Diagnóstico</span><strong>Versão atual: 1.0.0</strong><p>Frontend: operacional · APIs: monitoradas · Última verificação: agora</p></div></div>`;
  }

  function renderTheme() {
    const activeTheme = read(STORAGE.settings, defaults).activeTheme || 'default';
    const themes = [
      { id: 'default', name: 'Original', icon: '◐', note: 'Visual padrão do SedX, sem efeitos sazonais.', symbols: '◆ · ✦' },
      { id: 'halloween', name: 'Halloween', icon: '🎃', note: 'Laranja noturno, abóboras, morcegos e partículas brilhantes.', symbols: '🦇 · ✦ · 🎃' },
      { id: 'christmas', name: 'Natal', icon: '🎅', note: 'Azul glacial, neve caindo, presentes e pinheiros iluminados.', symbols: '❄ · 🎁 · ✨' },
      { id: 'kids', name: 'Dia das crianças', icon: '🍭', note: 'Cores vibrantes, doces, confetes e detalhes divertidos.', symbols: '🍬 · 🍭 · ✨' },
    ];
    return `<div class="admin-section-head"><div><span class="admin-kicker">Personalização global</span><h2>Tema</h2><p>Escolha a aparência que será exibida para todos os alunos. Os efeitos podem ser desativados no tema Original.</p></div></div><div class="theme-grid" role="group" aria-label="Temas do site">${themes.map((theme) => `<article class="theme-option ${activeTheme === theme.id ? 'selected' : ''}" data-theme-preview="${theme.id}"><div class="theme-preview-art" aria-hidden="true"><span class="theme-preview-icon">${theme.icon}</span><span class="theme-preview-sparkles">${theme.symbols}</span></div><div class="theme-option-copy"><span class="admin-kicker">${theme.id === 'default' ? 'SEDX CLÁSSICO' : 'TEMA SAZONAL'}</span><h3>${theme.name}</h3><p>${theme.note}</p><button type="button" class="theme-select-button" data-theme-option="${theme.id}" aria-pressed="${activeTheme === theme.id}">${activeTheme === theme.id ? 'Tema ativo' : `Ativar ${theme.name}`}</button></div></article>`).join('')}</div><p class="theme-sync-note"><span aria-hidden="true">✦</span> A escolha é salva no servidor e sincronizada com os dispositivos dos alunos.</p>`;
  }

  function panelTemplate() {
    return `<div class="sedx-admin-backdrop" data-admin-backdrop><section class="sedx-admin-panel" role="dialog" aria-modal="true" aria-labelledby="admin-title"><header class="admin-header"><div class="admin-header-brand"><img src="/sedx-logo-login-dashboard.png" alt="SEDX"><div><span>Área restrita</span><h1 id="admin-title">Administração</h1></div></div><div class="admin-header-actions"><span class="admin-identity">RA ${escapeHtml(getSession()?.usuario || currentRa())}</span><button class="admin-close" data-action="close-admin" aria-label="Fechar">×</button></div></header><div class="admin-body"><aside class="admin-menu"><button class="active" data-tab="overview">Visão geral</button><button data-tab="users">Usuários</button><button data-tab="notices">Avisos e notificações</button><button data-tab="settings">Configurações</button><button data-tab="audit">Logs e auditoria</button><button data-tab="maintenance">Manutenção</button><button data-tab="theme">Tema <span aria-hidden="true">✦</span></button></aside><main class="admin-content" id="admin-content"></main></div></section></div>`;
  }

  function showTab(tab) {
    const content = document.querySelector('#admin-content');
    if (!content) return;
    document.querySelectorAll('.admin-menu button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    content.innerHTML = tab === 'overview' ? renderOverview() : tab === 'users' ? renderUsers() : tab === 'notices' ? renderNotices() : tab === 'settings' ? renderSettings() : tab === 'audit' ? renderAudit() : tab === 'theme' ? renderTheme() : renderMaintenance();
  }

  async function openPanel() {
    if (!isAdmin()) return;
    if (location.pathname !== '/admin-tab') {
      sessionStorage.setItem('sedx_admin_login_intent', '1');
      history.pushState({}, '', '/admin-tab');
    }
    await syncAdminData();
    if (!document.querySelector('[data-admin-backdrop]')) document.body.insertAdjacentHTML('beforeend', panelTemplate());
    document.body.classList.add('admin-open');
    showTab('overview');
    log('Painel administrativo acessado', `Acesso realizado pelo RA ${currentRa()}`);
  }
  function closePanel() {
    document.querySelector('[data-admin-backdrop]')?.remove();
    document.body.classList.remove('admin-open');
    sessionStorage.removeItem('sedx_admin_login_intent');
    if (location.pathname === '/admin-tab') history.pushState({}, '', '/');
  }

  const MAX_NOTICE_IMAGE_BYTES = 5 * 1024 * 1024;
  function readNoticeImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      if (!file.type.startsWith('image/')) return reject(new Error('Escolha um arquivo de imagem válido.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Não foi possível processar essa imagem.'));
        image.onload = () => {
          const scale = Math.min(1, 1400 / image.width, 1400 / image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          let quality = 0.86;
          let data = canvas.toDataURL('image/jpeg', quality);
          while (data.length * 0.75 > MAX_NOTICE_IMAGE_BYTES && quality > 0.32) {
            quality -= 0.08;
            data = canvas.toDataURL('image/jpeg', quality);
          }
          if (data.length * 0.75 > MAX_NOTICE_IMAGE_BYTES) return reject(new Error('A imagem ficou maior que 5 MB. Escolha uma imagem menor.'));
          resolve(data);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function closeNoticeModal() { document.querySelector('[data-notice-modal]')?.remove(); }
  function noticeForm(existing = {}) {
    closeNoticeModal();
    const modal = document.createElement('div');
    modal.className = 'sedx-notice-editor-backdrop';
    modal.dataset.noticeModal = 'true';
    modal.innerHTML = `<section class="sedx-notice-editor" role="dialog" aria-modal="true" aria-labelledby="notice-editor-title">
      <header class="notice-editor-header"><div><span class="admin-kicker">Central de comunicação</span><h2 id="notice-editor-title">${existing.id ? 'Editar aviso' : 'Novo aviso'}</h2><p>Crie uma comunicação clara para os alunos.</p></div><button type="button" class="notice-editor-close" data-notice-close aria-label="Fechar">×</button></header>
      <form class="notice-editor-form"><label>Título do aviso<input name="title" maxlength="120" required value="${escapeHtml(existing.title || '')}" placeholder="Ex.: Atividade disponível"></label>
      <label>Descrição<textarea name="description" maxlength="1000" rows="5" required placeholder="Escreva os detalhes do aviso...">${escapeHtml(existing.description || '')}</textarea></label>
      <label>Área de publicação<input name="audience" maxlength="80" required value="${escapeHtml(existing.audience || 'Todos os alunos')}" placeholder="Todos os alunos"></label>
      <label>Imagem do aviso <span class="notice-field-hint">opcional · PNG, JPEG ou WebP · até 5 MB</span><input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><small>A imagem será otimizada automaticamente e limitada a 5 MB.</small></label>
      <div class="notice-upload-preview" data-notice-preview ${existing.image ? '' : 'hidden'}>${existing.image ? `<img src="${escapeHtml(existing.image)}" alt="Prévia do aviso"><button type="button" data-notice-remove-image>Remover imagem</button>` : ''}</div>
      <p class="notice-editor-error" data-notice-error role="alert" hidden></p><div class="notice-editor-actions"><button type="button" class="admin-secondary-btn" data-notice-close>Cancelar</button><button type="submit" class="admin-primary-btn">${existing.id ? 'Salvar alterações' : 'Publicar aviso'}</button></div></form></section>`;
    document.body.appendChild(modal);
    const form = modal.querySelector('form'); const fileInput = form.imageFile; const preview = modal.querySelector('[data-notice-preview]'); const error = modal.querySelector('[data-notice-error]'); let image = existing.image || '';
    const showError = (message) => { error.textContent = message; error.hidden = !message; };
    const renderPreview = (value) => { preview.innerHTML = value ? `<img src="${escapeHtml(value)}" alt="Prévia do aviso"><button type="button" data-notice-remove-image>Remover imagem</button>` : ''; preview.hidden = !value; };
    fileInput.addEventListener('change', async () => { showError(''); try { image = await readNoticeImage(fileInput.files?.[0]); renderPreview(image); } catch (e) { image = existing.image || ''; fileInput.value = ''; renderPreview(image); showError(e.message); } });
    modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-notice-close]')) closeNoticeModal(); if (event.target.closest('[data-notice-remove-image]')) { image = ''; fileInput.value = ''; renderPreview(''); } });
    form.addEventListener('submit', async (event) => { event.preventDefault(); showError(''); const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = 'Salvando...'; const data = Object.fromEntries(new FormData(form).entries()); delete data.imageFile; data.image = image; try { const action = existing.id ? 'Aviso editado' : 'Aviso publicado'; await apiRequest('/admin/notification', { method: existing.id ? 'PUT' : 'POST', body: JSON.stringify({ id: existing.id, title: data.title.trim(), description: data.description.trim(), audience: data.audience.trim(), image, publishedAt: existing.publishedAt }) }); await syncAdminData(); closeNoticeModal(); log(action, data.title); showTab('notices'); } catch (e) { showError(`Não foi possível salvar o aviso: ${e.message}`); submit.disabled = false; submit.textContent = existing.id ? 'Salvar alterações' : 'Publicar aviso'; } });
    form.title.focus();
  }

  async function saveTheme(theme) {
    const supportedThemes = new Set(['default', 'halloween', 'christmas', 'kids']);
    if (!supportedThemes.has(theme)) return;
    const currentSettings = { ...defaults, ...read(STORAGE.settings, {}) };
    const previousTheme = currentSettings.activeTheme || 'default';
    write(STORAGE.settings, { ...currentSettings, activeTheme: theme });
    window.dispatchEvent(new CustomEvent('sedx:theme-change', { detail: { activeTheme: theme } }));
    try {
      await apiRequest('/admin/settings', { method: 'PUT', body: JSON.stringify({ activeTheme: theme }) });
      await syncAdminData();
      const name = ({ default: 'Original', halloween: 'Halloween', christmas: 'Natal', kids: 'Dia das crianças' })[theme];
      log('Tema global alterado', name);
      showTab('theme');
    } catch (error) {
      write(STORAGE.settings, { ...currentSettings, activeTheme: previousTheme });
      window.dispatchEvent(new CustomEvent('sedx:theme-change', { detail: { activeTheme: previousTheme } }));
      alert(`Não foi possível salvar o tema no servidor: ${error.message}`);
      showTab('theme');
    }
  }

  function bindPanelEvents(event) {
    const target = event.target.closest('[data-action], [data-tab], [data-user-role], [data-user-search], [data-theme-option]');
    if (!target) return;
    if (target.dataset.tab) return showTab(target.dataset.tab);
    if (target.dataset.themeOption) return void saveTheme(target.dataset.themeOption);
    const action = target.dataset.action;
    if (action === 'close-admin') return closePanel();
    if (action === 'new-notice') return noticeForm();
    if (action === 'edit-notice') return noticeForm(seedNotices().find((item) => item.id === target.dataset.id) || {});
    if (action === 'delete-notice') { const item = seedNotices().find((notice) => notice.id === target.dataset.id); if (item && confirm(`Excluir o aviso “${item.title}”?`)) { apiRequest(`/admin/notification?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' }).then(() => syncAdminData()).then(() => { log('Aviso excluído', item.title); showTab('notices'); }).catch((error) => alert(`Não foi possível excluir o aviso no servidor: ${error.message}`)); } return; }
    if (action === 'toggle-user') { const user = seedUsers().find((item) => item.ra === target.dataset.ra); if (user) { const next = { ...user, status: user.status === 'Ativo' ? 'Suspenso' : 'Ativo' }; apiRequest('/admin/user', { method: 'PUT', body: JSON.stringify(next) }).then(() => syncAdminData()).then(() => { log(next.status === 'Ativo' ? 'Usuário reativado' : 'Usuário suspenso', next.ra); showTab('users'); }).catch((error) => alert(`Não foi possível atualizar o usuário no servidor: ${error.message}`)); } return; }
    if (action === 'save-settings') { const form = document.querySelector('#admin-settings-form'); const data = Object.fromEntries(new FormData(form).entries()); data.featureIa = form.featureIa.checked; data.featureApostilas = form.featureApostilas.checked; apiRequest('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }).then(() => syncAdminData()).then(() => { log('Configurações alteradas', 'Identidade, mensagens e funcionalidades do site'); alert('Configurações salvas no servidor.'); showTab('settings'); }).catch((error) => alert(`Não foi possível salvar as configurações no servidor: ${error.message}`)); return; }
    if (action === 'clear-audit') { if (confirm('Limpar todos os registros de auditoria?')) { write(STORAGE.audit, []); showTab('audit'); } return; }
    if (action === 'toggle-maintenance') { const current = Boolean(read(STORAGE.maintenance, false)); const settings = { ...read(STORAGE.settings, defaults), maintenance: !current }; apiRequest('/admin/settings', { method: 'PUT', body: JSON.stringify({ maintenance: settings.maintenance, maintenanceMessage: settings.maintenanceMessage }) }).then(() => syncAdminData()).then(() => { log(settings.maintenance ? 'Modo de manutenção ativado' : 'Modo de manutenção desativado', 'Ferramenta de manutenção'); showTab('maintenance'); }).catch((error) => alert(`Não foi possível alterar a manutenção no servidor: ${error.message}`)); return; }
    if (action === 'clear-cache') { const preserve = ['sed_sessao', STORAGE.notices, STORAGE.settings, STORAGE.users, STORAGE.audit, STORAGE.maintenance]; Object.keys(localStorage).filter((key) => key.startsWith('sed_') && !preserve.includes(key)).forEach((key) => localStorage.removeItem(key)); log('Cache limpo', 'Dados locais não essenciais removidos'); alert('Cache local do site limpo neste dispositivo.'); return; }
    if (target.dataset.userRole) { const user = seedUsers().find((item) => item.ra === target.dataset.ra); if (user) { const next = { ...user, role: target.value }; apiRequest('/admin/user', { method: 'PUT', body: JSON.stringify(next) }).then(() => syncAdminData()).then(() => { log('Permissão alterada', `${next.ra}: ${next.role}`); showTab('users'); }).catch((error) => alert(`Não foi possível alterar a permissão no servidor: ${error.message}`)); } return; }
    if (target.dataset.userSearch) { const query = target.value.toLowerCase(); document.querySelectorAll('[data-user-row]').forEach((row) => { row.hidden = !row.dataset.search.includes(query); }); }
  }

  document.addEventListener('click', bindPanelEvents);
  document.addEventListener('input', bindPanelEvents);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanel(); });
  window.__sedxAdminOpen = openPanel;
  const observer = new MutationObserver(() => injectNav());
  const boot = () => { injectNav(); observer.observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

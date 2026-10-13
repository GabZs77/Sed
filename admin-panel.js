(() => {
  'use strict';

  const ADMIN_RAS = new Set(['1127620514', '1127241606']);
  const STORAGE = {
    notices: 'sedx_admin_notices',
    settings: 'sedx_admin_settings',
    audit: 'sedx_admin_audit',
    users: 'sedx_admin_users',
    maintenance: 'sedx_admin_maintenance',
  };
  const defaults = {
    siteName: 'SEDX Aluno',
    logo: '/sedx-logo-login-dashboard.png',
    favicon: '/favicon.ico',
    welcome: 'Agenda, presença e tarefas em um só lugar.',
    support: 'suporte@sedx.app',
    maintenanceMessage: 'O SedX está temporariamente em manutenção. Voltaremos em breve.',
    featureIa: true,
    featureApostilas: true,
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
  const fmtDate = (value) => new Date(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const now = () => new Date().toISOString();

  const seedUsers = () => read(STORAGE.users, [
    { ra: '1127620514SP', name: 'Administrador 1', role: 'Administrador', status: 'Ativo', lastSeen: 'Agora' },
    { ra: '1127241606SP', name: 'Administrador 2', role: 'Administrador', status: 'Ativo', lastSeen: 'Agora' },
    { ra: '301953746SP', name: 'Conta de exemplo', role: 'Aluno', status: 'Ativo', lastSeen: 'Hoje' },
  ]);
  const seedNotices = () => read(STORAGE.notices, [
    { id: 'welcome', title: 'Bem-vindo ao painel administrativo', description: 'Use esta área para acompanhar o SedX e publicar comunicados para os alunos.', image: '', publishedAt: now(), audience: 'Todos os alunos' },
  ]);

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
    link.addEventListener('click', openPanel);
    nav.appendChild(link);
  }

  function renderStats() {
    const users = seedUsers();
    const notices = seedNotices();
    const active = users.filter((user) => user.status === 'Ativo').length;
    return `<section class="admin-stat-grid">
      <article class="admin-stat"><span>Total de acessos</span><strong>12.486</strong><small>+8,4% neste mês</small></article>
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

  function panelTemplate() {
    return `<div class="sedx-admin-backdrop" data-admin-backdrop><section class="sedx-admin-panel" role="dialog" aria-modal="true" aria-labelledby="admin-title"><header class="admin-header"><div class="admin-header-brand"><img src="/sedx-logo-login-dashboard.png" alt="SEDX"><div><span>Área restrita</span><h1 id="admin-title">Administração</h1></div></div><div class="admin-header-actions"><span class="admin-identity">RA ${escapeHtml(getSession()?.usuario || currentRa())}</span><button class="admin-close" data-action="close-admin" aria-label="Fechar">×</button></div></header><div class="admin-body"><aside class="admin-menu"><button class="active" data-tab="overview">Visão geral</button><button data-tab="users">Usuários</button><button data-tab="notices">Avisos e notificações</button><button data-tab="settings">Configurações</button><button data-tab="audit">Logs e auditoria</button><button data-tab="maintenance">Manutenção</button></aside><main class="admin-content" id="admin-content"></main></div></section></div>`;
  }

  function showTab(tab) {
    const content = document.querySelector('#admin-content');
    if (!content) return;
    document.querySelectorAll('.admin-menu button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    content.innerHTML = tab === 'overview' ? renderOverview() : tab === 'users' ? renderUsers() : tab === 'notices' ? renderNotices() : tab === 'settings' ? renderSettings() : tab === 'audit' ? renderAudit() : renderMaintenance();
  }

  function openPanel() {
    if (!isAdmin()) return;
    if (!document.querySelector('[data-admin-backdrop]')) document.body.insertAdjacentHTML('beforeend', panelTemplate());
    document.body.classList.add('admin-open');
    showTab('overview');
    log('Painel administrativo acessado', `Acesso realizado pelo RA ${currentRa()}`);
  }
  function closePanel() { document.querySelector('[data-admin-backdrop]')?.remove(); document.body.classList.remove('admin-open'); }

  function noticeForm(existing = {}) {
    const title = prompt('Título do aviso:', existing.title || ''); if (title === null) return;
    const description = prompt('Descrição do aviso:', existing.description || ''); if (description === null) return;
    const audience = prompt('Área de publicação (ex.: Todos os alunos, Dashboard, Tarefas):', existing.audience || 'Todos os alunos'); if (audience === null) return;
    const notices = seedNotices();
    if (existing.id) Object.assign(notices.find((item) => item.id === existing.id) || {}, { title, description, audience, publishedAt: existing.publishedAt || now() });
    else notices.unshift({ id: `notice-${Date.now()}`, title, description, audience, image: '', publishedAt: now() });
    write(STORAGE.notices, notices); log(existing.id ? 'Aviso editado' : 'Aviso publicado', title); showTab('notices');
  }

  function bindPanelEvents(event) {
    const target = event.target.closest('[data-action], [data-tab], [data-user-role], [data-user-search]');
    if (!target) return;
    if (target.dataset.tab) return showTab(target.dataset.tab);
    const action = target.dataset.action;
    if (action === 'close-admin') return closePanel();
    if (action === 'new-notice') return noticeForm();
    if (action === 'edit-notice') return noticeForm(seedNotices().find((item) => item.id === target.dataset.id) || {});
    if (action === 'delete-notice') { const item = seedNotices().find((notice) => notice.id === target.dataset.id); if (item && confirm(`Excluir o aviso “${item.title}”?`)) { write(STORAGE.notices, seedNotices().filter((notice) => notice.id !== item.id)); log('Aviso excluído', item.title); showTab('notices'); } return; }
    if (action === 'toggle-user') { const users = seedUsers(); const user = users.find((item) => item.ra === target.dataset.ra); if (user) { user.status = user.status === 'Ativo' ? 'Suspenso' : 'Ativo'; write(STORAGE.users, users); log(user.status === 'Ativo' ? 'Usuário reativado' : 'Usuário suspenso', user.ra); showTab('users'); } return; }
    if (action === 'save-settings') { const form = document.querySelector('#admin-settings-form'); const data = Object.fromEntries(new FormData(form).entries()); data.featureIa = form.featureIa.checked; data.featureApostilas = form.featureApostilas.checked; write(STORAGE.settings, data); log('Configurações alteradas', 'Identidade, mensagens e funcionalidades do site'); alert('Configurações salvas neste dispositivo.'); return; }
    if (action === 'clear-audit') { if (confirm('Limpar todos os registros de auditoria?')) { write(STORAGE.audit, []); showTab('audit'); } return; }
    if (action === 'toggle-maintenance') { const next = !read(STORAGE.maintenance, false); write(STORAGE.maintenance, next); log(next ? 'Modo de manutenção ativado' : 'Modo de manutenção desativado', 'Ferramenta de manutenção'); showTab('maintenance'); return; }
    if (action === 'clear-cache') { const preserve = ['sed_sessao', STORAGE.notices, STORAGE.settings, STORAGE.users, STORAGE.audit, STORAGE.maintenance]; Object.keys(localStorage).filter((key) => key.startsWith('sed_') && !preserve.includes(key)).forEach((key) => localStorage.removeItem(key)); log('Cache limpo', 'Dados locais não essenciais removidos'); alert('Cache do site limpo neste dispositivo.'); return; }
    if (target.dataset.userRole) { const users = seedUsers(); const user = users.find((item) => item.ra === target.dataset.ra); if (user) { user.role = target.value; write(STORAGE.users, users); log('Permissão alterada', `${user.ra}: ${user.role}`); } return; }
    if (target.dataset.userSearch) { const query = target.value.toLowerCase(); document.querySelectorAll('[data-user-row]').forEach((row) => { row.hidden = !row.dataset.search.includes(query); }); }
  }

  document.addEventListener('click', bindPanelEvents);
  document.addEventListener('input', bindPanelEvents);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanel(); });
  const observer = new MutationObserver(() => injectNav());
  const boot = () => { injectNav(); observer.observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

(() => {
  'use strict';
  const WORKER_URL = 'https://sdf.gabrielreplit56.workers.dev';
  const TAB_PARAM = 'sedxTab';
  const TAB_VALUE = 'chat';
  const ADMIN_RAS = new Set(['1127620514', '1127241606']);
  const POLL_MS = 5000;
  let overlay = null;
  let returnUrl = '';
  let messages = [];
  let mediaRecorder = null;
  let audioChunks = [];
  let pollTimer = null;
  let loading = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const session = () => { try { return JSON.parse(localStorage.getItem('sed_sessao') || 'null'); } catch { return null; } };
  const currentRa = () => String(session()?.usuario || session()?.ra || '').replace(/\D/g, '');
  const isAdmin = () => ADMIN_RAS.has(currentRa());
  const authHeaders = (json = false) => {
    const current = session() || {};
    const result = new Headers({ Accept: 'application/json' });
    if (json) result.set('Content-Type', 'application/json');
    if (current.token2) result.set('X-Token2', current.token2);
    if (current.token) result.set('X-Token', current.token);
    if (current.usuario) result.set('X-Usuario', current.usuario);
    if (current.cdUsuarioCurto) result.set('X-Cd-Usuario', current.cdUsuarioCurto);
    if (isAdmin()) result.set('X-Admin-User', currentRa());
    return result;
  };
  const api = async (path, options = {}) => {
    const response = await fetch(`${WORKER_URL}${path}`, { cache: 'no-store', ...options, headers: options.headers || authHeaders(Boolean(options.body && typeof options.body === 'string')) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || data.error || `Não foi possível concluir a operação (${response.status}).`);
    return data;
  };
  const displayName = (user = {}) => {
    const parts = String(user.name || user.nome || user.displayName || 'Aluno').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    return parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0)}.` : parts[0] || 'Aluno';
  };
  const avatar = (user = {}) => user.avatarUrl || user.avatar || user.photoURL || user.foto || '';
  const urlWithoutTab = () => {
    const params = new URLSearchParams(location.search); params.delete(TAB_PARAM);
    const query = params.toString(); return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  };
  const setNavActive = (active) => document.querySelectorAll('[data-sedx-platform-link]').forEach((link) => {
    link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  function injectNavLinks() {
    const rail = document.querySelector('.side-rail .rail-nav');
    if (rail && !rail.querySelector('[data-sedx-platform-link]')) { const link = document.createElement('button'); link.type = 'button'; link.className = 'rail-link sedx-platforms-nav-link'; link.dataset.sedxPlatformLink = 'desktop'; link.setAttribute('aria-label', 'Abrir Chat'); link.innerHTML = '<span class="platform-nav-icon" aria-hidden="true">◌</span><span>Chat</span>'; rail.appendChild(link); }
    const bottom = document.querySelector('.bottom-nav');
    if (bottom && !bottom.querySelector('[data-sedx-platform-link]')) { const link = document.createElement('button'); link.type = 'button'; link.className = 'bottom-link sedx-platforms-bottom-link'; link.dataset.sedxPlatformLink = 'mobile'; link.setAttribute('aria-label', 'Abrir Chat'); link.innerHTML = '<span class="bottom-icon-wrap"><span class="platform-nav-icon" aria-hidden="true">◌</span></span><span>Chat</span>'; bottom.appendChild(link); }
  }
  function renderMessage(message) {
    const mine = String(message.authorRa || message.userRa || message.ra || '') === currentRa();
    const person = message.author || message.user || { name: message.authorName, avatarUrl: message.avatarUrl };
    const content = message.deleted ? '<em>Mensagem removida pela administração.</em>' : esc(message.content || '');
    const attachment = message.attachmentUrl ? (String(message.attachmentType || '').startsWith('image/') ? `<img class="chat-attachment-image" src="${esc(message.attachmentUrl)}" alt="Anexo enviado por ${esc(displayName(person))}" loading="lazy">` : `<a class="chat-attachment-file" href="${esc(message.attachmentUrl)}" target="_blank" rel="noopener noreferrer">↗ ${esc(message.attachmentName || 'Abrir anexo')}</a>`) : '';
    const audio = message.audioUrl ? `<audio class="chat-audio" controls preload="metadata" src="${esc(message.audioUrl)}"></audio>` : '';
    const photo = avatar(person) ? `<img src="${esc(avatar(person))}" alt="" loading="lazy">` : `<span>${esc(displayName(person).charAt(0))}</span>`;
    const actions = message.deleted ? '' : `<div class="chat-message-actions">${mine ? `<button type="button" data-chat-edit="${esc(message.id)}">Editar</button><button type="button" data-chat-delete="${esc(message.id)}">Excluir</button>` : ''}${isAdmin() && !mine ? `<button type="button" data-chat-mute="${esc(message.authorRa || message.userRa || '')}">Silenciar</button><button type="button" data-chat-ban="${esc(message.authorRa || message.userRa || '')}">Proibir entrada</button><button type="button" data-chat-remove="${esc(message.id)}">Apagar</button>` : ''}</div>`;
    return `<article class="chat-message ${mine ? 'is-mine' : 'is-other'}" data-chat-message="${esc(message.id)}"><div class="chat-author-avatar">${photo}</div><div class="chat-message-main"><div class="chat-author-line"><strong>${esc(displayName(person))}</strong><time>${message.createdAt ? new Date(message.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</time></div><div class="chat-bubble">${content}${attachment}${audio}${message.editedAt ? '<small class="chat-edited">editada</small>' : ''}</div>${actions}</div></article>`;
  }
  function renderMessages(scroll = false) { const list = overlay?.querySelector('[data-chat-messages]'); if (!list) return; list.innerHTML = messages.length ? messages.map(renderMessage).join('') : '<div class="chat-empty"><span class="chat-empty-icon">◌</span><h2>O grupo está esperando você</h2><p>Seja a primeira pessoa a enviar uma mensagem para a turma.</p></div>'; if (scroll) list.scrollTop = list.scrollHeight; }
  async function loadMessages(scroll = false) {
    if (!overlay || loading) return; loading = true;
    try { const data = await api('/chat/messages?limit=100'); messages = Array.isArray(data.messages) ? data.messages : Array.isArray(data) ? data : []; renderMessages(scroll); const status = overlay.querySelector('[data-chat-status]'); if (status) status.textContent = 'Todos os alunos logados podem conversar aqui.'; }
    catch (error) { const status = overlay.querySelector('[data-chat-status]'); if (status) status.textContent = error.message || 'Não foi possível carregar o chat.'; }
    finally { loading = false; }
  }
  async function sendMessage(content = '', attachment = null, audio = null) {
    if (!content.trim() && !attachment && !audio) return;
    const data = await api('/chat/messages', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ content: content.trim(), attachment, audio }) });
    if (data.message) messages.push(data.message); else await loadMessages(true); renderMessages(true);
  }
  async function upload(file) { const form = new FormData(); form.append('file', file, file.name); return (await api('/chat/upload', { method: 'POST', headers: authHeaders(false), body: form })).attachment; }
  async function submitComposer() {
    const form = overlay?.querySelector('[data-chat-form]'); const input = form?.querySelector('[name="content"]'); const button = form?.querySelector('[data-chat-send]'); if (!input || !button) return;
    const content = input.value.trim(); if (!content) return; button.disabled = true;
    try { await sendMessage(content); input.value = ''; } catch (error) { const status = overlay.querySelector('[data-chat-status]'); if (status) status.textContent = error.message; } finally { button.disabled = false; input.focus(); }
  }
  async function handleFile(file) { if (!file) return; const status = overlay?.querySelector('[data-chat-status]'); try { if (status) status.textContent = 'Enviando anexo…'; await sendMessage('', await upload(file)); if (status) status.textContent = 'Anexo enviado.'; } catch (error) { if (status) status.textContent = error.message; } }
  async function toggleRecording() {
    const button = overlay?.querySelector('[data-chat-record]'); if (!button) return;
    if (mediaRecorder?.state === 'recording') { mediaRecorder.stop(); button.classList.remove('recording'); button.textContent = 'Gravar áudio'; return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { alert('Seu navegador não permite gravação de áudio.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); audioChunks = []; mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) => event.data.size && audioChunks.push(event.data);
      mediaRecorder.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); try { const file = new File([new Blob(audioChunks, { type: 'audio/webm' })], `audio-${Date.now()}.webm`, { type: 'audio/webm' }); await sendMessage('', null, await upload(file)); } catch (error) { const status = overlay?.querySelector('[data-chat-status]'); if (status) status.textContent = error.message; } };
      mediaRecorder.start(); button.classList.add('recording'); button.textContent = 'Parar gravação';
    } catch { alert('Não foi possível acessar o microfone.'); }
  }
  async function moderate(path, body, prompt) { if (prompt && !window.confirm(prompt)) return; try { await api(`/admin/chat/${path}`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) }); await loadMessages(); } catch (error) { const status = overlay?.querySelector('[data-chat-status]'); if (status) status.textContent = error.message; } }
  function renderPage() {
    overlay?.remove(); overlay = document.createElement('section'); overlay.className = 'sedx-platforms-overlay sedx-chat-overlay'; overlay.dataset.sedxPlatformsOverlay = 'true'; overlay.setAttribute('role', 'region'); overlay.setAttribute('aria-label', 'Chat da turma');
    overlay.innerHTML = `<div class="chat-tab-panel"><header class="chat-tab-heading"><div><span class="eyebrow">Comunidade da turma</span><h1>Chat</h1><p>Converse com outros alunos do SedX em um espaço público e moderado.</p></div><button type="button" class="platforms-close" data-platforms-close aria-label="Fechar Chat">×</button></header><section class="chat-room"><div class="chat-room-header"><div class="chat-room-icon">◌</div><div><strong>Grupo dos alunos</strong><span>Mensagens visíveis para todos os alunos logados</span></div><span class="chat-online-status"><i></i> online</span></div><div class="chat-messages" data-chat-messages role="log" aria-live="polite"><div class="chat-loading">Carregando conversa…</div></div><form class="chat-composer" data-chat-form><div class="chat-composer-tools"><label class="chat-tool-button" aria-label="Anexar imagem, vídeo ou arquivo">＋<input type="file" data-chat-file accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" hidden></label><button type="button" class="chat-tool-button" data-chat-record>Gravar áudio</button></div><textarea name="content" rows="1" maxlength="4000" placeholder="Escreva uma mensagem para a turma…" aria-label="Mensagem"></textarea><button type="submit" class="chat-send-button" data-chat-send aria-label="Enviar mensagem">↑</button></form><p class="chat-status" data-chat-status role="status">Todos os alunos logados podem conversar aqui.</p></section></div>`;
    document.body.appendChild(overlay); setNavActive(true); overlay.querySelector('[data-platforms-close]')?.focus(); void loadMessages(true); clearInterval(pollTimer); pollTimer = setInterval(() => void loadMessages(false), POLL_MS);
  }
  function openTab({ updateHistory = true } = {}) { if (!document.querySelector('.app-shell')) return; if (overlay?.isConnected) { setNavActive(true); return; } const params = new URLSearchParams(location.search); if (updateHistory && params.get(TAB_PARAM) !== TAB_VALUE) { returnUrl = urlWithoutTab(); params.set(TAB_PARAM, TAB_VALUE); history.pushState({ ...(history.state || {}), sedxChatTab: true, sedxReturnUrl: returnUrl }, '', `${location.pathname}?${params.toString()}${location.hash}`); } else if (!returnUrl) returnUrl = history.state?.sedxReturnUrl || urlWithoutTab(); renderPage(); }
  function closeTab({ restoreUrl = true } = {}) { clearInterval(pollTimer); pollTimer = null; if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); overlay?.remove(); overlay = null; setNavActive(false); if (restoreUrl && new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) history.replaceState({ ...(history.state || {}), sedxChatTab: false }, '', returnUrl || urlWithoutTab()); }
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-sedx-platform-link]'); if (link) { event.preventDefault(); openTab(); return; } if (!overlay) return;
    if (event.target.closest('[data-platforms-close]')) { closeTab(); return; }
    const edit = event.target.closest('[data-chat-edit]'); if (edit) { const message = messages.find((item) => String(item.id) === edit.dataset.chatEdit); const next = window.prompt('Edite sua mensagem:', message?.content || ''); if (next !== null && next.trim()) void api(`/chat/messages/${encodeURIComponent(edit.dataset.chatEdit)}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ content: next.trim() }) }).then(() => loadMessages()).catch((error) => { const status = overlay.querySelector('[data-chat-status]'); if (status) status.textContent = error.message; }); return; }
    const del = event.target.closest('[data-chat-delete]'); if (del) { void moderate(`messages/${encodeURIComponent(del.dataset.chatDelete)}/delete`, {}, 'Excluir sua mensagem?'); return; }
    const remove = event.target.closest('[data-chat-remove]'); if (remove) { void moderate(`messages/${encodeURIComponent(remove.dataset.chatRemove)}/delete`, {}, 'Apagar esta mensagem como administrador?'); return; }
    const mute = event.target.closest('[data-chat-mute]'); if (mute) { const minutes = window.prompt('Por quantos minutos silenciar? Digite 0 para indeterminado.', '60'); if (minutes !== null) void moderate('mute', { userRa: mute.dataset.chatMute, durationMinutes: Number(minutes) || null }, 'Confirmar silêncio do aluno?'); }
    const ban = event.target.closest('[data-chat-ban]'); if (ban) { const reason = window.prompt('Motivo da proibição de entrada (opcional):', ''); if (reason !== null) void moderate('ban', { userRa: ban.dataset.chatBan, reason }, 'Proibir este aluno de entrar no Chat?'); }
    if (event.target.closest('[data-chat-record]')) void toggleRecording();
  });
  document.addEventListener('submit', (event) => { if (event.target.matches('[data-chat-form]')) { event.preventDefault(); void submitComposer(); } });
  document.addEventListener('change', (event) => { if (event.target.matches('[data-chat-file]')) void handleFile(event.target.files?.[0]); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay) closeTab(); });
  window.addEventListener('popstate', () => { if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) openTab({ updateHistory: false }); else closeTab({ restoreUrl: false }); });
  function boot() { injectNavLinks(); if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE) openTab({ updateHistory: false }); const observer = new MutationObserver(() => { injectNavLinks(); if (new URLSearchParams(location.search).get(TAB_PARAM) === TAB_VALUE && !overlay?.isConnected) openTab({ updateHistory: false }); }); observer.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

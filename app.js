/* ============================================================
   JuntaFoto · Conexão Profissional 2026
   ============================================================ */

/* ── Configuração Cloudinary ── */
const CLOUDINARY_CLOUD_NAME   = 'vyodkyhe';
const CLOUDINARY_UPLOAD_PRESET = 'juntafoto_preset';
const CLOUDINARY_FOLDER        = 'conexao2026';

/* ── A palavra-chave fica no servidor (/api/access) e é alterada no painel admin ── */

/* ── Tempo sem usar o app antes de pedir a palavra-chave de novo (o admin pode mudar) ── */
const DEFAULT_SESSION_MINUTES = 15;
const SESSION_CHECK_INTERVAL  = 5_000;              // confere a inatividade a cada 5 s
const GALLERY_POLL_INTERVAL   = 60_000;             // 60 segundos
const ACTIVITY_EVENTS         = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'];
const FEATURED_FILTER         = '__destaques';
const MINE_FILTER             = '__minhas';
const MAX_BATCH               = 10;                 // fotos por envio

/* ============================================================
   Estado
   ============================================================ */
const state = {
  photos:        [],
  nextCursor:    null,
  isLoading:     false,
  isUploading:   false,
  selectedFile:  null,  // a foto, quando há só uma (prévia e moldura usam esta)
  selectedFiles: [],    // todas as escolhidas: { id, file, url (miniatura), status: wait|sending|ok|err }
  pollTimer:     null,
  sessionTimer:  null,
  authenticated: false,
  lastActivitySaved: 0,
  album:         '',   // filtro da galeria: '' = todas, FEATURED_FILTER ou id do álbum
  config: {
    sessionMinutes: DEFAULT_SESSION_MINUTES,
    uploadsOpen:    true,
    moderation:     false,
    defaultAlbum:   '',
    albums:         [],
    framesEnabled:  true,
    hashtags:       DEFAULT_HASHTAGS,
    shareCaption:   'Eu fui no Conexão Profissional 2026! 🚀',
    event:          DEFAULT_EVENT,
    frames:         DEFAULT_FRAMES,
  },
  deletedIds:    new Set(), // excluídas agora: some mesmo se a lista vier do cache por alguns segundos
  // Moldura na foto aberta e na prévia do envio
  viewer:      { photo: null, source: null, canvas: null, token: 0 },
  uploadFrame: { source: null, canvas: null, token: 0, preview: '' },
};

let viewerFrameCtl = null;
let uploadFrameCtl = null;

/* ── Atalho DOM — chamado APÓS DOMContentLoaded ── */
const $ = (id) => document.getElementById(id);

/* ============================================================
   Inicialização — tudo dentro do DOMContentLoaded
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {

  /* --- Service Worker --- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  /* --- Banner de config --- */
  if (CLOUDINARY_CLOUD_NAME === 'SEU_CLOUD_NAME' || CLOUDINARY_UPLOAD_PRESET === 'SEU_PRESET') {
    $('configBanner').hidden = false;
  }

  /* --- Tema claro / escuro / automático (tema.js) --- */
  initThemeToggle((msg) => showToast(msg));

  /* --- Eventos --- */
  bindEvents();
  viewerFrameCtl = createFrameControl($('viewerFrame'), updateViewerFrame);
  uploadFrameCtl = createFrameControl($('uploadFrame'), updateUploadFrame);

  /* --- Configurações do evento (álbuns, tempo de sessão, envios) --- */
  await loadConfig();

  /* --- Verifica sessão (e se o participante já registrou o nome neste aparelho) --- */
  profile = loadProfile();
  if (sessionRemainingMs() > 0) {
    if (profile) unlockApp();
    else showNameScreen();
  } else {
    clearSession();
    showPasswordScreen();
  }

  /* --- Qualquer toque, rolagem ou tecla conta como "usando o app" --- */
  ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true, capture: true }));

  /* --- Revalida a sessão ao voltar para o app (celular suspende timers em segundo plano) --- */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
  window.addEventListener('focus', checkSession);
  window.addEventListener('pageshow', checkSession);
});

/* ============================================================
   CONFIGURAÇÕES DO EVENTO
   ============================================================ */
async function loadConfig() {
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch('/api/config', { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) state.config = { ...state.config, ...(await res.json()) };
  } catch (_) { /* sem servidor: usa os valores padrão */ }
  applyEventTheme(state.config.event); // nome, cores e logo do evento (evento.js)
  // Atualiza as molduras disponíveis, sem atrapalhar quem está com uma moldura aberta
  if (!viewerFrameCtl?.on) viewerFrameCtl?.setFrames(state.config.frames);
  if (!uploadFrameCtl?.on) uploadFrameCtl?.setFrames(state.config.frames);
  renderAlbumFilters();
  renderAlbumSelect();
}

/* ============================================================
   SESSÃO (expira após X minutos sem usar o app)
   ============================================================ */
function sessionTimeoutMs() {
  return (state.config.sessionMinutes || DEFAULT_SESSION_MINUTES) * 60 * 1000;
}

function sessionRemainingMs() {
  if (sessionStorage.getItem('jf_auth') !== '1') return 0;
  const lastActivity = parseInt(sessionStorage.getItem('jf_last') || '0', 10);
  return Math.max(0, sessionTimeoutMs() - (Date.now() - lastActivity));
}

function saveActivity() {
  state.lastActivitySaved = Date.now();
  sessionStorage.setItem('jf_last', String(state.lastActivitySaved));
}

function markActivity() {
  if (!state.authenticated) return;
  // Se já passou do tempo (ex.: celular bloqueado), o toque não "revive" a sessão
  if (sessionRemainingMs() <= 0) { expireSession(); return; }
  if (Date.now() - state.lastActivitySaved > 1000) saveActivity();
}

function clearSession() {
  sessionStorage.removeItem('jf_auth');
  sessionStorage.removeItem('jf_last');
}

function checkSession() {
  if (!state.authenticated) return;
  if (state.isUploading) saveActivity(); // envio em andamento conta como uso
  if (sessionRemainingMs() <= 0) expireSession();
}

/* ============================================================
   PERFIL DO PARTICIPANTE (nome + chave secreta deste aparelho)
   A chave nunca é mostrada; as fotos guardam só a impressão digital dela (SHA-256).
   Para excluir, o servidor confere se a chave enviada gera a mesma impressão digital.
   ============================================================ */
const PROFILE_KEY = 'jf_profile';
let profile = null; // { name, secret, owner }

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p && p.name && /^[0-9a-f]{64}$/.test(p.secret) && /^[0-9a-f]{64}$/.test(p.owner)) return p;
  } catch (_) { /* sem armazenamento ou dado inválido */ }
  return null;
}

function saveProfile(p) {
  profile = p;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (_) { /* vale só nesta visita */ }
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isMine = (photo) => !!profile && !!photo.owner && photo.owner === profile.owner;

function renderHello() {
  $('helloBar').hidden = !profile;
  if (profile) $('helloName').textContent = profile.name;
}

/* Exclui uma foto que este aparelho enviou */
async function deleteMyPhoto() {
  const photo = state.viewer.photo;
  if (!photo || !isMine(photo)) return;
  if (!confirm('Excluir esta foto da galeria? Não tem como desfazer.')) return;
  const btn = $('btnDeleteMine');
  btn.disabled = true;
  btn.textContent = 'Excluindo…';
  try {
    const res  = await fetch('/api/my-photo', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: photo.id, secret: profile.secret }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    state.deletedIds.add(photo.id);
    state.photos = state.photos.filter((p) => p.id !== photo.id);
    closeViewer();
    renderGallery();
    showToast('🗑️ Foto excluída.');
  } catch (err) {
    showToast(err.message || 'Não foi possível excluir. Tente de novo.', 4000);
  } finally {
    btn.disabled = false;
    btn.textContent = '🗑️ Excluir minha foto';
  }
}

/* ============================================================
   TELA DE SENHA
   ============================================================ */
function showPasswordScreen() {
  $('passwordScreen').hidden = false;
  $('appContent').hidden     = true;
  // Limpa estado de autenticação
  state.authenticated = false;
  clearSession();
  clearInterval(state.sessionTimer);
  clearInterval(state.pollTimer);
  // Reseta o botão caso tenha ficado desabilitado
  const btn = $('btnEnter');
  btn.disabled    = false;
  btn.textContent = 'Entrar na galeria →';
  $('passwordInput').value = '';
  $('passwordError').hidden = true;
  showStep('password');
  setTimeout(() => $('passwordInput').focus(), 200);
}

/* A caixa da tela inicial tem dois passos: palavra-chave e (só no 1º acesso) o nome */
function showStep(step) {
  $('passwordStep').hidden = step !== 'password';
  $('passwordHint').hidden = step !== 'password';
  $('nameStep').hidden     = step !== 'name';
}

/* Pede o nome sem encerrar a sessão (1º acesso ou "trocar nome") */
function showNameScreen() {
  $('passwordScreen').hidden = false;
  $('appContent').hidden     = true;
  showStep('name');
  $('nameInput').value      = profile?.name || '';
  $('nameError').hidden     = true;
  $('btnSaveName').disabled = false;
  $('btnSaveName').textContent = profile ? 'Salvar nome →' : 'Continuar →';
  setTimeout(() => $('nameInput').focus(), 200);
}

async function saveName() {
  const name = $('nameInput').value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    $('nameError').textContent = 'Digite seu nome (pelo menos 2 letras).';
    $('nameError').hidden = false;
    $('nameInput').focus();
    return;
  }
  $('btnSaveName').disabled = true;
  try {
    // Trocar o nome mantém a mesma chave: as fotos já enviadas continuam sendo suas
    const secret = profile?.secret || randomSecret();
    saveProfile({ name, secret, owner: profile?.owner || await sha256Hex(secret) });
  } catch (_) {
    $('nameError').textContent = 'Não foi possível salvar. Atualize a página e tente de novo.';
    $('nameError').hidden = false;
    $('btnSaveName').disabled = false;
    return;
  }
  unlockApp();
}

function unlockApp() {
  state.authenticated    = true;
  $('passwordScreen').hidden = true;
  $('appContent').hidden     = false;
  renderHello();
  loadPhotos();
  startPolling();
  startSessionTimer();
}

async function checkPassword() {
  const input = $('passwordInput').value.trim();
  if (!input) return;
  const btn = $('btnEnter');
  btn.disabled    = true;
  btn.textContent = 'Verificando…';

  let ok = false;
  try {
    const res = await fetch('/api/access', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: input }),
    });
    if (!res.ok) throw new Error();
    ok = (await res.json()).ok;
  } catch (_) {
    showPasswordError('Sem conexão com o servidor. Tente novamente.');
    return;
  }

  if (ok) {
    sessionStorage.setItem('jf_auth', '1');
    saveActivity();
    $('passwordError').hidden = true;
    btn.textContent = '✓ Entrando…';
    // 1º acesso neste aparelho: pede o nome antes de entrar
    setTimeout(() => (profile ? unlockApp() : showNameScreen()), 400);
  } else {
    showPasswordError('Palavra-chave incorreta. Tente novamente.');
    if (navigator.vibrate) navigator.vibrate(200);
  }
}

function showPasswordError(msg) {
  const err = $('passwordError');
  err.hidden      = false;
  err.textContent = msg;
  const btn = $('btnEnter');
  btn.disabled    = false;
  btn.textContent = 'Entrar na galeria →';
  $('passwordInput').value = '';
  $('passwordInput').focus();
}

/* ============================================================
   TIMER DE SESSÃO
   ============================================================ */
function startSessionTimer() {
  clearInterval(state.sessionTimer);
  state.sessionTimer = setInterval(checkSession, SESSION_CHECK_INTERVAL);
}

function expireSession() {
  // Não interrompe um envio em andamento
  if (state.isUploading) return;
  state.authenticated = false;
  clearInterval(state.sessionTimer);
  clearInterval(state.pollTimer);
  // Fecha qualquer modal aberto
  $('uploadModal').hidden = true;
  $('viewerModal').hidden = true;
  document.body.style.overflow = '';
  // Limpa sessão e mostra tela de senha
  clearSession();
  showToast('Sessão expirada por inatividade. Digite a palavra-chave novamente.');
  setTimeout(showPasswordScreen, 1500);
}

/* ============================================================
   EVENTOS
   ============================================================ */
function bindEvents() {

  /* Tela de senha */
  $('btnEnter').addEventListener('click', checkPassword);
  $('passwordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkPassword();
  });

  /* Nome do participante (1º acesso) e "trocar nome" */
  $('btnSaveName').addEventListener('click', saveName);
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
  $('btnChangeName').addEventListener('click', showNameScreen);

  /* Excluir uma foto própria */
  $('btnDeleteMine').addEventListener('click', deleteMyPhoto);

  /* Abrir modal de upload */
  $('btnUploadHeader').addEventListener('click', openUploadModal);
  $('btnUploadHero').addEventListener('click', openUploadModal);
  $('fabUpload').addEventListener('click', openUploadModal);

  /* Fechar modais */
  $('btnCloseModal').addEventListener('click', closeUploadModal);
  $('btnCloseViewer').addEventListener('click', closeViewer);
  $('uploadModal').addEventListener('click', (e) => { if (e.target === $('uploadModal')) closeUploadModal(); });
  $('viewerModal').addEventListener('click', (e) => { if (e.target === $('viewerModal')) closeViewer(); });

  /* ESC */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('uploadModal').hidden) closeUploadModal();
      if (!$('viewerModal').hidden) closeViewer();
    }
  });

  /* Botões câmera / galeria */
  $('btnCamera').addEventListener('click',  () => $('fileInputCamera').click());
  $('btnGallery').addEventListener('click', () => $('fileInput').click());

  /* Drag & drop (desktop) */
  const dropArea = $('dropArea');
  dropArea.addEventListener('dragover',  (e) => { e.preventDefault(); dropArea.classList.add('dragover'); });
  dropArea.addEventListener('dragleave', ()  => dropArea.classList.remove('dragover'));
  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });

  /* Inputs de arquivo (a galeria permite marcar várias; cada escolha soma à lista) */
  $('fileInput').addEventListener('change', () => {
    addFiles($('fileInput').files);
    $('fileInput').value = ''; // permite escolher a mesma foto de novo depois de tirar da lista
  });
  $('fileInputCamera').addEventListener('change', () => {
    addFiles($('fileInputCamera').files);
    $('fileInputCamera').value = '';
  });

  /* Enviar */
  $('btnSend').addEventListener('click', uploadPhoto);

  /* Atualizar galeria */
  $('btnRefresh').addEventListener('click', () => {
    state.photos = [];
    state.nextCursor = null;
    loadPhotos();
  });

  /* Carregar mais fotos */
  $('btnLoadMore').addEventListener('click', () => loadPhotos(true));

  /* Download e compartilhamento */
  $('btnShare').addEventListener('click', sharePhoto);
  $('btnDownload').addEventListener('click', async (e) => {
    if (!state.viewer.canvas) return; // sem moldura: o link baixa a foto original
    e.preventDefault();
    downloadBlob(await canvasToJpeg(state.viewer.canvas), 'conexao-profissional-2026.jpg');
  });
  $('btnCaption').addEventListener('click', () => copyToClipboard(buildShareCaption(), 'Legenda copiada! É só colar no Instagram.'));
  $('btnShareFramedUpload').addEventListener('click', () => {
    if (state.uploadFrame.canvas) shareFramed(state.uploadFrame.canvas);
  });

  /* Visibilidade da aba */
  document.addEventListener('visibilitychange', () => {
    if (!state.authenticated) return;
    if (document.hidden) {
      clearInterval(state.pollTimer);
    } else {
      state.photos = [];
      state.nextCursor = null;
      loadPhotos();
      startPolling();
    }
  });
}

/* ============================================================
   FILTRO POR ÁLBUM
   ============================================================ */
function renderAlbumFilters() {
  const bar = $('albumFilters');
  bar.innerHTML = '';
  const albums = state.config.albums || [];
  bar.hidden = false;

  // "Minhas fotos" sempre aparece; "Destaques" e álbuns quando o admin cria álbuns
  const chips = [{ id: '', name: 'Todas' }, { id: MINE_FILTER, name: '📷 Minhas fotos' },
    ...(albums.length ? [{ id: FEATURED_FILTER, name: '⭐ Destaques' }, ...albums] : [])];
  chips.forEach((a) => {
    const chip = document.createElement('button');
    chip.type        = 'button';
    chip.className   = 'album-chip' + (state.album === a.id ? ' active' : '');
    chip.textContent = a.name;
    chip.addEventListener('click', () => {
      if (state.album === a.id) return;
      state.album      = a.id;
      state.photos     = [];
      state.nextCursor = null;
      renderAlbumFilters();
      loadPhotos();
    });
    bar.appendChild(chip);
  });
}

function renderAlbumSelect() {
  const albums = state.config.albums || [];
  $('albumGroup').hidden = albums.length === 0;
  const sel = $('albumSelect');
  sel.innerHTML = '<option value="">Sem álbum</option>';
  albums.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  });
}

/* ============================================================
   MODAL DE UPLOAD
   ============================================================ */
function openUploadModal() {
  if (!state.config.uploadsOpen) {
    showToast('Os envios de fotos estão encerrados no momento.');
    return;
  }
  resetUploadModal();
  $('uploadModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeUploadModal() {
  $('uploadModal').hidden = true;
  document.body.style.overflow = '';
  $('fileInput').value = '';
  $('fileInputCamera').value = '';
  resetUploadModal();
}

function resetUploadModal() {
  state.selectedFiles.forEach((it) => URL.revokeObjectURL(it.url));
  state.selectedFiles = [];
  state.selectedFile = null;
  state.isUploading  = false;
  $('previewImg').hidden    = true;
  $('previewImg').src       = '';
  $('multiPreview').hidden  = true;
  $('multiPreview').replaceChildren();
  $('multiInfo').hidden     = true;
  $('dropPlaceholder').hidden = false;
  $('progressWrap').hidden  = true;
  $('progressBar').style.width = '0%';
  $('uploadError').hidden   = true;
  $('uploadError').textContent = '';
  $('authorName').value     = profile?.name || '';
  state.uploadFrame = { source: null, canvas: null, token: state.uploadFrame.token + 1, preview: '' };
  uploadFrameCtl?.reset();
  $('uploadFrame').hidden = true;
  $('btnShareFramedUpload').hidden = true;
  // Sugere o álbum que está aberto na galeria, senão o padrão definido pelo admin
  const albums = state.config.albums || [];
  const current = albums.some((a) => a.id === state.album) ? state.album : state.config.defaultAlbum;
  $('albumSelect').value = current || '';
  setSendButton(false, 'Enviar para a galeria');
}

const SEND_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>`;

function setSendButton(enabled, label) {
  const btn = $('btnSend');
  btn.disabled  = !enabled;
  btn.innerHTML = `${SEND_ICON} ${label}`;
}

/* ============================================================
   SELEÇÃO DE ARQUIVOS (uma ou várias)
   ============================================================ */
/* Mantido para quem escolhe uma foto só (câmera, testes) */
function handleFileSelected(file) {
  addFiles([file]);
}

function addFiles(fileList) {
  if (state.isUploading) return;
  const all    = [...(fileList || [])];
  const images = all.filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    if (all.length) showUploadError('Selecione um arquivo de imagem (JPG, PNG, HEIC, etc.).');
    return;
  }
  // Fotos que já foram (✓) num envio anterior saem da lista; as que falharam continuam
  dropSentFiles();
  const room = MAX_BATCH - state.selectedFiles.length;
  if (room <= 0) { showToast(`Máximo de ${MAX_BATCH} fotos por envio.`); return; }
  images.slice(0, room).forEach((file) => {
    state.selectedFiles.push({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file), status: 'wait' });
  });
  if (images.length > room) showToast(`Só cabem ${MAX_BATCH} fotos por envio — ${images.length - room} ficaram de fora.`, 4000);
  $('uploadError').hidden = true;
  renderSelection();
}

function dropSentFiles() {
  state.selectedFiles.filter((it) => it.status === 'ok').forEach((it) => URL.revokeObjectURL(it.url));
  state.selectedFiles = state.selectedFiles.filter((it) => it.status !== 'ok');
}

function removeFile(id) {
  if (state.isUploading) return;
  const it = state.selectedFiles.find((x) => x.id === id);
  if (it) URL.revokeObjectURL(it.url);
  state.selectedFiles = state.selectedFiles.filter((x) => x.id !== id);
  renderSelection();
}

/* Uma foto: prévia grande + moldura (como antes). Várias: grade de miniaturas. */
function renderSelection() {
  const items = state.selectedFiles;
  const n = items.length;
  const single = n === 1;
  const previous = state.selectedFile;
  state.selectedFile = single ? items[0].file : null;

  $('dropPlaceholder').hidden = n > 0;
  $('multiPreview').hidden    = n < 2;
  $('multiInfo').hidden       = n < 2;
  if (!single) {
    $('previewImg').hidden = true;
    $('uploadFrame').hidden = true;
    $('btnShareFramedUpload').hidden = true;
    uploadFrameCtl.reset();
  }

  if (single && previous !== items[0].file) {
    state.uploadFrame = { source: null, canvas: null, token: state.uploadFrame.token + 1, preview: '' };
    uploadFrameCtl.reset();
    $('btnShareFramedUpload').hidden = true;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (state.selectedFile !== items[0].file) return; // mudou a seleção enquanto lia
      state.uploadFrame.preview = e.target.result;
      $('previewImg').src    = e.target.result;
      $('previewImg').hidden = false;
      $('uploadFrame').hidden = !state.config.framesEnabled;
    };
    reader.readAsDataURL(items[0].file);
  }

  if (n >= 2) {
    $('multiPreview').replaceChildren(...items.map((it) => {
      const cell = document.createElement('div');
      cell.className = `multi-item is-${it.status}`;
      const img = Object.assign(document.createElement('img'), { src: it.url, alt: '' });
      cell.appendChild(img);
      if (!state.isUploading && (it.status === 'wait' || it.status === 'err')) {
        const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'multi-remove', textContent: '✕' });
        rm.setAttribute('aria-label', 'Tirar esta foto do envio');
        rm.addEventListener('click', (e) => { e.stopPropagation(); removeFile(it.id); });
        cell.appendChild(rm);
      }
      const badge = { sending: '⏳', ok: '✓', err: '⚠' }[it.status];
      if (badge) cell.appendChild(Object.assign(document.createElement('span'), { className: 'multi-status', textContent: badge }));
      return cell;
    }));
    const left = MAX_BATCH - n;
    $('multiInfo').textContent = `${n} fotos selecionadas · toque no ✕ para tirar${left > 0 ? ` · cabem mais ${left}` : ''}`;
  }

  const pending = items.filter((it) => it.status !== 'ok').length;
  if (!state.isUploading) {
    const failed = items.some((it) => it.status === 'err');
    setSendButton(pending > 0, failed ? 'Tentar novamente' : pending > 1 ? `Enviar ${pending} fotos para a galeria` : 'Enviar para a galeria');
  }
}

/* ============================================================
   UPLOAD PARA O CLOUDINARY
   ============================================================ */
/* Envia todas as fotos escolhidas, uma por vez (as que já foram ficam com ✓ e não repetem) */
async function uploadPhoto() {
  const queue = state.selectedFiles.filter((it) => it.status !== 'ok');
  if (!queue.length || state.isUploading) return;
  if (CLOUDINARY_CLOUD_NAME === 'SEU_CLOUD_NAME') {
    showUploadError('Configure as credenciais do Cloudinary no arquivo app.js.');
    return;
  }

  state.isUploading = true;
  $('btnSend').disabled = true;
  $('btnSend').innerHTML = '<div class="spinner" style="width:22px;height:22px;border-width:3px"></div> Enviando…';
  $('uploadError').hidden = true;
  $('progressWrap').hidden = false;
  setProgress(0, 'Preparando…');

  const total = queue.length;
  let sent = 0;
  for (const [i, item] of queue.entries()) {
    item.status = 'sending';
    renderSelection();
    const label = total > 1 ? `Enviando ${i + 1} de ${total}…` : 'Enviando…';
    try {
      await sendOnePhoto(item.file, (frac) => {
        const pct = Math.round(((i + frac) / total) * 100);
        setProgress(Math.min(99, pct), total > 1 ? `${label} ${pct}%` : `${label} ${pct}%`);
      });
      item.status = 'ok';
      sent++;
    } catch (err) {
      item.status = 'err';
      item.error  = err.message;
    }
    saveActivity(); // envio longo conta como uso do app
  }

  state.isUploading = false;
  const failed = queue.filter((it) => it.status === 'err');
  if (!failed.length) {
    setProgress(100, 'Concluído!');
    const what = sent > 1 ? `${sent} fotos enviadas` : 'Foto enviada';
    showToast(state.config.moderation
      ? `🎉 ${what}! Aparecem na galeria depois da aprovação.`
      : `🎉 ${what}! Aparecendo na galeria…`, 4000);
    closeUploadModal();
  } else {
    renderSelection();
    showUploadError(sent
      ? `${sent} de ${total} enviadas. ${failed.length} com erro (${failed[0].error || 'falha'}) — toque em "Tentar novamente".`
      : (failed[0].error || 'Erro ao enviar. Tente novamente.'));
  }
  // A busca do Cloudinary leva alguns segundos para indexar a foto nova
  if (sent) setTimeout(() => { state.photos = []; state.nextCursor = null; loadPhotos(false, true); }, 5000);
}

/* Converte/comprime (imagem.js) e envia uma foto ao Cloudinary; onProgress recebe de 0 a 1 */
async function sendOnePhoto(file, onProgress) {
  onProgress(0.05);
  const prepared = prepareForUpload(file);

  const author    = $('authorName').value.trim() || 'Participante';
  const authorTag = 'autor_' + author.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
  const album     = $('albumSelect').value;
  const tags      = [state.config.event.tag, 'juntafoto', authorTag];
  if (album) tags.push(`album_${album}`);
  if (state.config.moderation) tags.push('pendente');

  const formData = new FormData();
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('asset_folder',  CLOUDINARY_FOLDER);
  formData.append('folder',        CLOUDINARY_FOLDER);
  formData.append('tags',          tags.join(','));
  // owner = impressão digital da chave deste aparelho: permite excluir depois só as próprias fotos
  formData.append('context',       `author=${author.replace(/([|=\\])/g, '\\$1')}${profile ? `|owner=${profile.owner}` : ''}`);

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  formData.append('file', await prepared);
  onProgress(0.1);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(0.1 + (e.loaded / e.total) * 0.85);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(JSON.parse(xhr.responseText));
      } else {
        let msg = `Erro ${xhr.status}`;
        try { const b = JSON.parse(xhr.responseText); if (b.error?.message) msg = b.error.message; } catch (_) {}
        reject(new Error(msg));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Falha de conexão.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelado.')));
    xhr.open('POST', url);
    xhr.send(formData);
  });
}

function setProgress(pct, label) {
  const pb = $('progressBar');
  pb.style.width = `${pct}%`;
  pb.setAttribute('aria-valuenow', pct);
  $('progressLabel').textContent = label;
}

/* ============================================================
   GALERIA
   ============================================================ */
/* fresh = pula o cache curto da Vercel (logo depois de enviar uma foto) */
async function loadPhotos(append = false, fresh = false) {
  if (state.isLoading) return;
  state.isLoading = true;
  if (!append) {
    $('loadingState').style.display = 'flex';
    $('emptyState').hidden    = true;
    $('galleryToolbar').hidden = true;
  }
  try {
    const res = await fetch(buildPhotosUrl(append, fresh));
    if (!res.ok) throw new Error('Erro ao carregar fotos');
    const data = await res.json();
    state.nextCursor = data.nextCursor || null;
    const newPhotos = (data.photos || []).filter((p) => !state.deletedIds.has(p.id)).map(withImageUrls);
    state.photos = append ? [...state.photos, ...newPhotos] : newPhotos;
    renderGallery(append ? newPhotos : null);
  } catch (_) {
    if (state.photos.length === 0) $('emptyState').hidden = false;
  } finally {
    state.isLoading = false;
    $('loadingState').style.display = 'none';
    $('btnLoadMore').hidden = !state.nextCursor;
  }
}

function buildPhotosUrl(append, fresh = false) {
  const params = new URLSearchParams();
  if (state.album === FEATURED_FILTER)  params.set('featured', '1');
  else if (state.album === MINE_FILTER) params.set('owner', profile?.owner || '-');
  else if (state.album)                 params.set('album', state.album);
  if (append && state.nextCursor)       params.set('cursor', state.nextCursor);
  if (fresh)                            params.set('t', Date.now());
  return `/api/photos?${params}`;
}

/* Monta as URLs de miniatura/ampliada aplicando a rotação definida pelo admin */
function cloudinaryUrl(photo, transform) {
  const rotate = photo.angle ? `a_${photo.angle}/` : '';
  return photo.url.replace('/upload/', `/upload/${rotate}${transform}/`);
}

function withImageUrls(photo) {
  return {
    ...photo,
    thumb:    cloudinaryUrl(photo, 'c_fill,w_400,h_400,q_auto,f_auto'),
    full:     cloudinaryUrl(photo, 'w_1200,q_auto,f_auto'),
    download: cloudinaryUrl(photo, 'fl_attachment'),
  };
}

function renderGallery(appended = null) {
  const grid     = $('galleryGrid');
  const hero     = $('hero');
  if (!appended) grid.innerHTML = '';

  if (state.photos.length === 0) {
    // Com um álbum selecionado, mostra só o vazio (sem o hero de boas-vindas)
    hero.hidden = !!state.album;
    $('emptyState').hidden    = false;
    $('galleryToolbar').hidden = !state.album;
    $('photoCount').textContent = '0 fotos';
    return;
  }

  hero.hidden = true;
  $('emptyState').hidden    = true;
  $('galleryToolbar').hidden = false;
  $('photoCount').textContent = `${state.photos.length}${state.nextCursor ? '+' : ''} foto${state.photos.length !== 1 ? 's' : ''}`;

  (appended || state.photos).forEach((photo) => {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Foto de ${photo.author}`);

    const img = document.createElement('img');
    img.src       = photo.thumb;
    img.alt       = `Foto de ${photo.author}`;
    img.loading   = 'lazy';
    img.decoding  = 'async';

    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';
    const authorEl = document.createElement('span');
    authorEl.className   = 'gallery-item-author';
    authorEl.textContent = (photo.featured ? '⭐ ' : '') + photo.author;
    overlay.appendChild(authorEl);
    if (isMine(photo)) {
      const mine = document.createElement('span');
      mine.className   = 'gallery-item-mine';
      mine.textContent = 'Você';
      item.appendChild(mine);
    }

    item.appendChild(img);
    item.appendChild(overlay);
    item.addEventListener('click',   () => openViewer(photo));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openViewer(photo); });
    grid.appendChild(item);
  });
}

/* ============================================================
   VIEWER
   ============================================================ */
function openViewer(photo) {
  $('viewerImg').src    = photo.full;
  $('viewerImg').alt    = `Foto de ${photo.author}`;
  $('viewerAuthor').textContent = photo.author;
  $('viewerDate').textContent   = formatDate(photo.createdAt);
  $('viewerCaption').textContent = photo.caption || '';
  $('viewerCaption').hidden      = !photo.caption;
  const dl = $('btnDownload');
  dl.href     = photo.download;
  dl.download = `conexao2026-${Date.now()}.jpg`;
  $('btnShare').dataset.url    = photo.full;
  $('btnShare').dataset.author = photo.author;
  state.viewer = { photo, source: null, canvas: null, token: state.viewer.token + 1 };
  viewerFrameCtl.reset();
  $('viewerFrame').hidden = !state.config.framesEnabled;
  $('btnCaption').hidden  = !state.config.framesEnabled;
  $('btnDeleteMine').hidden = !isMine(photo); // só nas fotos enviadas por este aparelho
  $('viewerModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  $('viewerModal').hidden = true;
  document.body.style.overflow = '';
  $('viewerImg').src = '';
  state.viewer = { photo: null, source: null, canvas: null, token: state.viewer.token + 1 };
}

/* ============================================================
   MOLDURA DO EVENTO (desenho em moldura.js)
   ============================================================ */
/* Controle "Sem moldura / Com moldura" + modelos + selo. Usado no visualizador e no envio. */
function createFrameControl(container, onChange) {
  const ctl = { on: false, template: '', badge: true };
  let frames = [];
  let chips  = [];

  const toggle = document.createElement('div');
  toggle.className = 'frame-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Moldura do evento');
  const btnOff = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Sem moldura' });
  const btnOn  = Object.assign(document.createElement('button'), { type: 'button', textContent: '✨ Com moldura' });
  toggle.append(btnOff, btnOn);

  const options = document.createElement('div');
  options.className = 'frame-options';
  const badgeLabel = document.createElement('label');
  badgeLabel.className = 'frame-badge-toggle';
  const badgeInput = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
  const badgeText  = document.createElement('span');
  badgeLabel.append(badgeInput, badgeText);

  function sync() {
    btnOff.classList.toggle('active', !ctl.on);
    btnOn.classList.toggle('active', ctl.on);
    btnOff.setAttribute('aria-pressed', String(!ctl.on));
    btnOn.setAttribute('aria-pressed', String(ctl.on));
    options.hidden = !ctl.on;
    chips.forEach((c, i) => c.classList.toggle('active', frames[i].id === ctl.template));
    badgeInput.checked = ctl.badge;
    const current = frames.find((f) => f.id === ctl.template);
    badgeText.textContent = ` Selo "${current?.badgeText || 'EU FUI!'}"`;
  }

  /* Molduras cadastradas no painel (muda quando o admin cria/edita molduras) */
  ctl.setFrames = (list) => {
    frames = list.length ? list : DEFAULT_FRAMES;
    if (!frames.some((f) => f.id === ctl.template)) ctl.template = frames[0].id;
    chips = frames.map((f) => {
      const chip = Object.assign(document.createElement('button'), { type: 'button', className: 'frame-chip', textContent: f.name });
      chip.addEventListener('click', () => { ctl.template = f.id; sync(); onChange(ctl); });
      return chip;
    });
    options.replaceChildren(...chips, badgeLabel);
    sync();
  };

  btnOff.addEventListener('click', () => { if (!ctl.on) return; ctl.on = false; sync(); onChange(ctl); });
  btnOn.addEventListener('click',  () => { if (ctl.on) return;  ctl.on = true;  sync(); onChange(ctl); });
  badgeInput.addEventListener('change', () => { ctl.badge = badgeInput.checked; onChange(ctl); });

  ctl.reset = () => { ctl.on = false; sync(); };
  container.replaceChildren(toggle, options);
  ctl.setFrames(state.config.frames);
  return ctl;
}

/* Moldura escolhida → estilo-base + tema (cores, nome e logo do evento, com as trocas da moldura) */
function frameOptions(ctl, date) {
  const frames = state.config.frames.length ? state.config.frames : DEFAULT_FRAMES;
  const frame  = frames.find((f) => f.id === ctl.template) || frames[0];
  return {
    template: frame.base,
    badge:    ctl.badge,
    hashtags: state.config.hashtags,
    date,
    theme:    buildFrameTheme(state.config.event, frame),
  };
}

async function updateViewerFrame(ctl) {
  const v     = state.viewer;
  const token = ++v.token;
  const img   = $('viewerImg');
  if (!ctl.on) {
    v.canvas = null;
    img.src  = v.photo.full;
    return;
  }
  img.classList.add('is-loading');
  try {
    v.source = v.source || await loadFrameImage(cloudinaryUrl(v.photo, 'w_1600,q_auto'));
    const canvas = await renderFrame(v.source, frameOptions(ctl, v.photo.createdAt));
    if (token !== state.viewer.token) return; // trocou de foto/opção no meio do caminho
    v.canvas = canvas;
    img.src  = canvas.toDataURL('image/jpeg', 0.9);
  } catch (err) {
    showToast(err.message || 'Não foi possível aplicar a moldura.');
  } finally {
    img.classList.remove('is-loading');
  }
}

async function updateUploadFrame(ctl) {
  const u     = state.uploadFrame;
  const token = ++u.token;
  $('btnShareFramedUpload').hidden = !ctl.on;
  if (!ctl.on) {
    u.canvas = null;
    $('previewImg').src = u.preview;
    return;
  }
  try {
    u.source = u.source || await loadImage(state.selectedFile); // loadImage em imagem.js
    const canvas = await renderFrame(u.source, frameOptions(ctl));
    if (token !== state.uploadFrame.token) return;
    u.canvas = canvas;
    $('previewImg').src = canvas.toDataURL('image/jpeg', 0.9);
  } catch (err) {
    showUploadError(err.message || 'Não foi possível aplicar a moldura.');
  }
}

function buildShareCaption() {
  return [state.config.shareCaption, state.config.hashtags].filter(Boolean).join('\n\n');
}

/* Copia a legenda (o Instagram não aceita legenda vinda de outro app) e abre o compartilhamento */
async function shareFramed(canvas) {
  const caption = buildShareCaption();
  try { await navigator.clipboard?.writeText(caption); } catch (_) { /* segue sem copiar */ }
  const result = await shareOrDownloadFramed(canvas, { caption });
  if (result === 'shared')     showToast('📋 Legenda copiada! No Instagram, é só colar.', 4500);
  if (result === 'downloaded') showToast('Foto baixada! A legenda foi copiada — é só colar no Instagram.', 4500);
}

/* ============================================================
   COMPARTILHAMENTO
   ============================================================ */
async function sharePhoto() {
  if (state.viewer.canvas) return shareFramed(state.viewer.canvas);
  const url    = $('btnShare').dataset.url;
  const author = $('btnShare').dataset.author || 'Participante';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Conexão Profissional 2026', text: `Foto de ${author} 📸`, url });
    } catch (e) {
      if (e.name !== 'AbortError') copyToClipboard(url);
    }
  } else {
    copyToClipboard(url);
  }
}

function copyToClipboard(text, message = 'Link copiado!') {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast(message));
  } else {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    Object.assign(ta.style, { position: 'fixed', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(message);
  }
}

/* ============================================================
   POLLING
   ============================================================ */
function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    // Só atualiza sozinho se a pessoa não carregou mais páginas (para não perder a posição)
    if (!document.hidden && $('uploadModal').hidden && $('viewerModal').hidden && state.authenticated && state.photos.length <= 60) {
      state.photos = [];
      state.nextCursor = null;
      loadPhotos();
      loadConfig();
    }
  }, GALLERY_POLL_INTERVAL);
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer;
function showToast(msg, duration = 3000) {
  const t = $('toast');
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function showUploadError(msg) {
  const el = $('uploadError');
  el.textContent = msg;
  el.hidden = false;
}

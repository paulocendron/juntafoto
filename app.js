/* ============================================================
   JuntaFoto · Conexão Profissional 2026
   ============================================================ */

/* ── Configuração Cloudinary ── */
const CLOUDINARY_CLOUD_NAME   = 'vyodkyhe';
const CLOUDINARY_UPLOAD_PRESET = 'juntafoto_preset';
const CLOUDINARY_FOLDER        = 'conexao2026';

/* ── A palavra-chave fica no servidor (/api/access) e é alterada no painel admin ── */

/* ── Tempo sem usar o app antes de pedir a palavra-chave de novo (o admin pode mudar) ── */
const DEFAULT_SESSION_MINUTES = 5;
const SESSION_CHECK_INTERVAL  = 5_000;              // confere a inatividade a cada 5 s
const GALLERY_POLL_INTERVAL   = 60_000;             // 60 segundos
const ACTIVITY_EVENTS         = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'];
const FEATURED_FILTER         = '__destaques';

/* ============================================================
   Estado
   ============================================================ */
const state = {
  photos:        [],
  nextCursor:    null,
  isLoading:     false,
  isUploading:   false,
  selectedFile:  null,
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
  },
};

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

  /* --- Eventos --- */
  bindEvents();

  /* --- Configurações do evento (álbuns, tempo de sessão, envios) --- */
  await loadConfig();

  /* --- Verifica sessão --- */
  if (sessionRemainingMs() > 0) {
    unlockApp();
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
  setTimeout(() => $('passwordInput').focus(), 200);
}

function unlockApp() {
  state.authenticated    = true;
  $('passwordScreen').hidden = true;
  $('appContent').hidden     = false;
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
    setTimeout(unlockApp, 400);
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
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });

  /* Inputs de arquivo */
  $('fileInput').addEventListener('change', () => {
    if ($('fileInput').files[0]) handleFileSelected($('fileInput').files[0]);
  });
  $('fileInputCamera').addEventListener('change', () => {
    if ($('fileInputCamera').files[0]) handleFileSelected($('fileInputCamera').files[0]);
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
  if (albums.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;

  const chips = [{ id: '', name: 'Todas' }, { id: FEATURED_FILTER, name: '⭐ Destaques' }, ...albums];
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
  state.selectedFile = null;
  state.isUploading  = false;
  $('previewImg').hidden    = true;
  $('previewImg').src       = '';
  $('dropPlaceholder').hidden = false;
  $('progressWrap').hidden  = true;
  $('progressBar').style.width = '0%';
  $('uploadError').hidden   = true;
  $('uploadError').textContent = '';
  $('authorName').value     = '';
  // Sugere o álbum que está aberto na galeria, senão o padrão definido pelo admin
  const albums = state.config.albums || [];
  const current = albums.some((a) => a.id === state.album) ? state.album : state.config.defaultAlbum;
  $('albumSelect').value = current || '';
  const btn = $('btnSend');
  btn.disabled = true;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
    Enviar para a galeria`;
}

/* ============================================================
   SELEÇÃO DE ARQUIVO
   ============================================================ */
function handleFileSelected(file) {
  if (!file.type.startsWith('image/')) {
    showUploadError('Selecione um arquivo de imagem (JPG, PNG, HEIC, etc.).');
    return;
  }
  state.selectedFile = file;
  $('uploadError').hidden = true;

  const reader = new FileReader();
  reader.onload = (e) => {
    $('previewImg').src    = e.target.result;
    $('previewImg').hidden = false;
    $('dropPlaceholder').hidden = true;
  };
  reader.readAsDataURL(file);
  $('btnSend').disabled = false;
}

/* ============================================================
   UPLOAD PARA O CLOUDINARY
   ============================================================ */
async function uploadPhoto() {
  if (!state.selectedFile || state.isUploading) return;
  if (CLOUDINARY_CLOUD_NAME === 'SEU_CLOUD_NAME') {
    showUploadError('Configure as credenciais do Cloudinary no arquivo app.js.');
    return;
  }

  state.isUploading = true;
  const btnSend = $('btnSend');
  btnSend.disabled = true;
  btnSend.innerHTML = '<div class="spinner" style="width:22px;height:22px;border-width:3px"></div> Enviando…';
  $('uploadError').hidden = true;
  $('progressWrap').hidden = false;
  setProgress(0, 'Preparando…');

  setProgress(5, 'Convertendo para JPEG…');
  const prepared = prepareForUpload(state.selectedFile); // conversão/compressão em imagem.js

  const author    = $('authorName').value.trim() || 'Participante';
  const authorTag = 'autor_' + author.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
  const album     = $('albumSelect').value;
  const tags      = ['conexao2026', 'juntafoto', authorTag];
  if (album) tags.push(`album_${album}`);
  if (state.config.moderation) tags.push('pendente');

  const formData = new FormData();
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('asset_folder',  CLOUDINARY_FOLDER);
  formData.append('folder',        CLOUDINARY_FOLDER);
  formData.append('tags',          tags.join(','));
  formData.append('context',       `author=${author.replace(/([|=\\])/g, '\\$1')}`);

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  try {
    formData.append('file', await prepared);
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 90), `Enviando… ${Math.round((e.loaded / e.total) * 90)}%`);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress(100, 'Concluído!');
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

    state.isUploading = false;
    saveActivity();
    showToast(state.config.moderation
      ? '🎉 Foto enviada! Ela aparece na galeria depois da aprovação.'
      : '🎉 Foto enviada! Aparecendo na galeria…', 4000);
    closeUploadModal();
    // A busca do Cloudinary leva alguns segundos para indexar a foto nova
    setTimeout(() => { state.photos = []; state.nextCursor = null; loadPhotos(); }, 5000);

  } catch (err) {
    showUploadError(err.message || 'Erro ao enviar. Tente novamente.');
    state.isUploading = false;
    btnSend.disabled  = false;
    btnSend.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
      Tentar novamente`;
  }
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
async function loadPhotos(append = false) {
  if (state.isLoading) return;
  state.isLoading = true;
  if (!append) {
    $('loadingState').style.display = 'flex';
    $('emptyState').hidden    = true;
    $('galleryToolbar').hidden = true;
  }
  try {
    const res = await fetch(buildPhotosUrl(append));
    if (!res.ok) throw new Error('Erro ao carregar fotos');
    const data = await res.json();
    state.nextCursor = data.nextCursor || null;
    const newPhotos = (data.photos || []).map(withImageUrls);
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

function buildPhotosUrl(append) {
  const params = new URLSearchParams();
  if (state.album === FEATURED_FILTER) params.set('featured', '1');
  else if (state.album)                params.set('album', state.album);
  if (append && state.nextCursor)      params.set('cursor', state.nextCursor);
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
  $('viewerModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  $('viewerModal').hidden = true;
  document.body.style.overflow = '';
  $('viewerImg').src = '';
}

/* ============================================================
   COMPARTILHAMENTO
   ============================================================ */
async function sharePhoto() {
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

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Link copiado!'));
  } else {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    Object.assign(ta.style, { position: 'fixed', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Link copiado!');
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

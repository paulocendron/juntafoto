/* ============================================================
   JuntaFoto · Conexão Profissional 2026
   ============================================================ */

/* ── Configuração Cloudinary ── */
const CLOUDINARY_CLOUD_NAME   = 'vyodkyhe';
const CLOUDINARY_UPLOAD_PRESET = 'juntafoto_preset';
const CLOUDINARY_FOLDER        = 'conexao2026';

/* ── Palavra-chave de acesso ── */
const ACCESS_PASSWORD = 'conexao2026';

/* ── Tempo de sessão antes de pedir a senha novamente ── */
const SESSION_TIMEOUT_MS   = 2 * 60 * 1000; // 2 minutos
const GALLERY_POLL_INTERVAL = 30_000;        // 30 segundos
const MAX_FILE_SIZE         = 10 * 1024 * 1024; // 10 MB

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
};

/* ── Atalho DOM — chamado APÓS DOMContentLoaded ── */
const $ = (id) => document.getElementById(id);

/* ============================================================
   Inicialização — tudo dentro do DOMContentLoaded
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

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

  /* --- Verifica sessão --- */
  if (sessionRemainingMs() > 0) {
    unlockApp();
  } else {
    clearSession();
    showPasswordScreen();
  }

  /* --- Revalida a sessão ao voltar para o app (celular suspende timers em segundo plano) --- */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
  window.addEventListener('focus', checkSession);
  window.addEventListener('pageshow', checkSession);
});

/* ============================================================
   SESSÃO
   ============================================================ */
function sessionRemainingMs() {
  if (sessionStorage.getItem('jf_auth') !== ACCESS_PASSWORD) return 0;
  const savedTime = parseInt(sessionStorage.getItem('jf_auth_time') || '0', 10);
  return Math.max(0, SESSION_TIMEOUT_MS - (Date.now() - savedTime));
}

function clearSession() {
  sessionStorage.removeItem('jf_auth');
  sessionStorage.removeItem('jf_auth_time');
}

function checkSession() {
  if (state.authenticated && sessionRemainingMs() <= 0) expireSession();
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
  clearTimeout(state.sessionTimer);
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

function checkPassword() {
  const input   = $('passwordInput').value.trim().toLowerCase();
  const correct = ACCESS_PASSWORD.toLowerCase();

  if (input === correct) {
    sessionStorage.setItem('jf_auth',      ACCESS_PASSWORD);
    sessionStorage.setItem('jf_auth_time', Date.now().toString());
    $('passwordError').hidden = true;
    const btn = $('btnEnter');
    btn.textContent = '✓ Entrando…';
    btn.disabled    = true;
    setTimeout(unlockApp, 400);
  } else {
    const err = $('passwordError');
    err.hidden      = false;
    err.textContent = 'Palavra-chave incorreta. Tente novamente.';
    $('passwordInput').value = '';
    $('passwordInput').focus();
    if (navigator.vibrate) navigator.vibrate(200);
  }
}

/* ============================================================
   TIMER DE SESSÃO (expira após SESSION_TIMEOUT_MS)
   ============================================================ */
function startSessionTimer() {
  clearTimeout(state.sessionTimer);
  // Usa o tempo restante real (desde o login), não um novo período de 2 min
  state.sessionTimer = setTimeout(checkSession, sessionRemainingMs() + 100);
}

function expireSession() {
  // Não interrompe um envio em andamento: tenta de novo em alguns segundos
  if (state.isUploading) {
    clearTimeout(state.sessionTimer);
    state.sessionTimer = setTimeout(checkSession, 3000);
    return;
  }
  state.authenticated = false;
  clearTimeout(state.sessionTimer);
  clearInterval(state.pollTimer);
  // Fecha qualquer modal aberto
  $('uploadModal').hidden = true;
  $('viewerModal').hidden = true;
  document.body.style.overflow = '';
  // Limpa sessão e mostra tela de senha
  clearSession();
  showToast('Sessão expirada. Digite a palavra-chave novamente.');
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
   MODAL DE UPLOAD
   ============================================================ */
function openUploadModal() {
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
  if (file.size > MAX_FILE_SIZE) {
    showUploadError('O arquivo é muito grande. Máximo permitido: 10 MB.');
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
   CONVERSÃO PARA JPEG
   ============================================================ */
function convertToJpeg(file, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 2400;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM; }
          else                { width  = Math.round(width  * MAX_DIM / height); height = MAX_DIM; }
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('Falha ao converter.')); return; }
          const name = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
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

  let fileToUpload;
  try {
    setProgress(5, 'Convertendo para JPEG…');
    fileToUpload = await convertToJpeg(state.selectedFile);
  } catch (e) {
    fileToUpload = state.selectedFile;
  }

  const author    = $('authorName').value.trim() || 'Participante';
  const authorTag = 'autor_' + author.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);

  const formData = new FormData();
  formData.append('file',          fileToUpload);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('asset_folder',  CLOUDINARY_FOLDER);
  formData.append('folder',        CLOUDINARY_FOLDER);
  formData.append('tags',          `conexao2026,juntafoto,${authorTag}`);
  formData.append('context',       `author=${encodeURIComponent(author)}`);

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  try {
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

    showToast('🎉 Foto enviada! Aparecendo na galeria…');
    closeUploadModal();
    setTimeout(() => { state.photos = []; state.nextCursor = null; loadPhotos(); }, 1500);

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
    const res = await fetch(buildSearchUrl());
    if (!res.ok) throw new Error('Erro ao carregar fotos');
    const data = await res.json();
    state.nextCursor = data.next_cursor || null;
    const newPhotos = (data.resources || []).map(parseCloudinaryResource);
    state.photos = append ? [...state.photos, ...newPhotos] : newPhotos;
    renderGallery(append);
  } catch (_) {
    if (state.photos.length === 0) $('emptyState').hidden = false;
  } finally {
    state.isLoading = false;
    $('loadingState').style.display = 'none';
  }
}

function buildSearchUrl() {
  const expr = encodeURIComponent(`folder:${CLOUDINARY_FOLDER} AND tags:conexao2026`);
  let url = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/search/`
    + `expression=${expr}/sort_by[created_at]=desc/max_results=60/with_field=context`;
  if (state.nextCursor) url += `/next_cursor=${encodeURIComponent(state.nextCursor)}`;
  return url;
}

function parseCloudinaryResource(r) {
  return {
    id:        r.public_id,
    url:       r.secure_url,
    thumb:     r.secure_url.replace('/upload/', '/upload/c_fill,w_400,h_400,q_auto,f_auto/'),
    full:      r.secure_url.replace('/upload/', '/upload/w_1200,q_auto,f_auto/'),
    author:    r.context?.custom?.author || 'Participante',
    createdAt: r.created_at,
  };
}

function renderGallery(append = false) {
  const grid     = $('galleryGrid');
  const hero     = $('hero');
  if (!append) grid.innerHTML = '';

  if (state.photos.length === 0) {
    hero.hidden = false;
    $('emptyState').hidden    = false;
    $('galleryToolbar').hidden = true;
    return;
  }

  hero.hidden = true;
  $('emptyState').hidden    = true;
  $('galleryToolbar').hidden = false;
  $('photoCount').textContent = `${state.photos.length} foto${state.photos.length !== 1 ? 's' : ''}`;

  const list = append ? state.photos.slice(-(state.photos.length % 60 || 60)) : state.photos;
  list.forEach((photo) => {
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
    authorEl.textContent = photo.author;
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
  const dl = $('btnDownload');
  dl.href     = photo.url.replace('/upload/', '/upload/fl_attachment/');
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
    if (!document.hidden && $('uploadModal').hidden && state.authenticated) {
      state.photos = [];
      state.nextCursor = null;
      loadPhotos();
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

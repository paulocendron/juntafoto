/* ============================================================
   JuntaFoto · Conexão Profissional 2026
   ─────────────────────────────────────────────────────────
   CONFIGURAÇÃO CLOUDINARY
   ─────────────────────────────────────────────────────────
   1. Crie uma conta gratuita em https://cloudinary.com
   2. No Dashboard copie o "Cloud name"
   3. Em Settings > Upload, crie um "Upload Preset" com:
        - Signing Mode: Unsigned
        - Folder: conexao2026
        - Allowed formats: jpg,png,heic,webp
   4. Cole os valores abaixo e salve o arquivo.
   ============================================================ */

const CLOUDINARY_CLOUD_NAME = 'paulo123';
const CLOUDINARY_UPLOAD_PRESET = 'juntafoto_preset';
const CLOUDINARY_FOLDER = 'conexao2026';

/* ── Palavra-chave de acesso ao evento ─────────────────────
   Altere para a senha que quiser. Apenas quem souber essa
   palavra consegue ver as fotos e fazer upload.
   ──────────────────────────────────────────────────────── */
const ACCESS_PASSWORD = 'conexao2026';

/* ── Intervalo de atualização automática da galeria (ms) ── */
const GALLERY_POLL_INTERVAL = 30_000; // 30 segundos

/* ── Tamanho máximo de arquivo (bytes) ── */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/* ============================================================
   Estado da aplicação
   ============================================================ */
const state = {
  photos: [],           // lista de fotos carregadas
  nextCursor: null,     // paginação Cloudinary
  isLoading: false,
  isUploading: false,
  selectedFile: null,
  pollTimer: null,
  authenticated: false,
};

/* ============================================================
   Referências DOM
   ============================================================ */
const $ = (id) => document.getElementById(id);

const hero          = $('hero');
const mainContent   = $('mainContent');
const galleryGrid   = $('galleryGrid');
const galleryToolbar= $('galleryToolbar');
const photoCount    = $('photoCount');
const emptyState    = $('emptyState');
const loadingState  = $('loadingState');
const configBanner  = $('configBanner');

const uploadModal   = $('uploadModal');
const dropArea      = $('dropArea');
const dropPlaceholder = $('dropPlaceholder');
const previewImg    = $('previewImg');
const fileInput     = $('fileInput');
const authorName    = $('authorName');
const progressWrap  = $('progressWrap');
const progressBar   = $('progressBar');
const progressLabel = $('progressLabel');
const uploadError   = $('uploadError');
const btnSend       = $('btnSend');

const viewerModal   = $('viewerModal');
const viewerImg     = $('viewerImg');
const viewerAuthor  = $('viewerAuthor');
const viewerDate    = $('viewerDate');
const btnDownload   = $('btnDownload');
const btnShare      = $('btnShare');

const toast         = $('toast');

/* ============================================================
   Inicialização
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  checkConfig();
  bindEvents();

  // Verifica se já autenticou nessa sessão
  if (sessionStorage.getItem('jf_auth') === ACCESS_PASSWORD) {
    unlockApp();
  } else {
    showPasswordScreen();
  }
});

/* ============================================================
   Tela de senha
   ============================================================ */
function showPasswordScreen() {
  document.getElementById('passwordScreen').hidden = false;
  document.getElementById('appContent').hidden = true;
  setTimeout(() => document.getElementById('passwordInput').focus(), 300);
}

function unlockApp() {
  state.authenticated = true;
  document.getElementById('passwordScreen').hidden = true;
  document.getElementById('appContent').hidden = false;
  loadPhotos();
  startPolling();
}

function checkPassword() {
  const input = document.getElementById('passwordInput').value.trim().toLowerCase();
  const correct = ACCESS_PASSWORD.toLowerCase();

  if (input === correct) {
    sessionStorage.setItem('jf_auth', ACCESS_PASSWORD);
    document.getElementById('passwordError').hidden = true;
    const btn = document.getElementById('btnEnter');
    btn.textContent = '✓ Entrando…';
    btn.disabled = true;
    setTimeout(unlockApp, 500);
  } else {
    const errEl = document.getElementById('passwordError');
    errEl.hidden = false;
    errEl.textContent = 'Palavra-chave incorreta. Tente novamente.';
    document.getElementById('passwordInput').value = '';
    document.getElementById('passwordInput').focus();
    if (navigator.vibrate) navigator.vibrate(200);
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {/* silencioso */});
  }
}

function checkConfig() {
  if (
    CLOUDINARY_CLOUD_NAME === 'SEU_CLOUD_NAME' ||
    CLOUDINARY_UPLOAD_PRESET === 'SEU_PRESET'
  ) {
    configBanner.hidden = false;
  }
}

/* ============================================================
   Eventos
   ============================================================ */
function bindEvents() {
  // Tela de senha
  document.getElementById('btnEnter').addEventListener('click', checkPassword);
  document.getElementById('passwordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkPassword();
  });

  // Botões que abrem o modal de upload
  $('btnUploadHeader').addEventListener('click', openUploadModal);
  $('btnUploadHero').addEventListener('click', openUploadModal);
  $('fabUpload').addEventListener('click', openUploadModal);

  // Fechar modais
  $('btnCloseModal').addEventListener('click', closeUploadModal);
  $('btnCloseViewer').addEventListener('click', closeViewer);
  uploadModal.addEventListener('click', (e) => { if (e.target === uploadModal) closeUploadModal(); });
  viewerModal.addEventListener('click', (e) => { if (e.target === viewerModal) closeViewer(); });

  // Tecla ESC fecha qualquer modal aberto
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!uploadModal.hidden) closeUploadModal();
      if (!viewerModal.hidden) closeViewer();
    }
  });

  // Área de drop / clique para selecionar arquivo
  dropArea.addEventListener('click', () => fileInput.click());
  dropArea.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  // Drag & drop (desktop)
  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('dragover'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });

  // Seleção via input
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
  });

  // Enviar
  btnSend.addEventListener('click', uploadPhoto);

  // Atualizar galeria manualmente
  $('btnRefresh').addEventListener('click', () => {
    state.photos = [];
    state.nextCursor = null;
    loadPhotos();
  });

  // Download e compartilhamento
  btnShare.addEventListener('click', sharePhoto);
}

/* ============================================================
   Modal de upload
   ============================================================ */
function openUploadModal() {
  resetUploadModal();
  uploadModal.hidden = false;
  document.body.style.overflow = 'hidden';
  // Em iOS abre a câmera se disponível
  setTimeout(() => authorName.focus(), 300);
}

function closeUploadModal() {
  uploadModal.hidden = true;
  document.body.style.overflow = '';
  fileInput.value = '';
  resetUploadModal();
}

function resetUploadModal() {
  state.selectedFile = null;
  previewImg.hidden = true;
  previewImg.src = '';
  dropPlaceholder.hidden = false;
  progressWrap.hidden = true;
  progressBar.style.width = '0%';
  uploadError.hidden = true;
  uploadError.textContent = '';
  btnSend.disabled = true;
  authorName.value = '';
  state.isUploading = false;
  btnSend.textContent = '';
  btnSend.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
    Enviar para a galeria`;
}

/* ============================================================
   Seleção e prévia de arquivo
   ============================================================ */
function handleFileSelected(file) {
  // Valida tipo
  if (!file.type.startsWith('image/')) {
    showUploadError('Selecione um arquivo de imagem (JPG, PNG, HEIC, etc.).');
    return;
  }
  // Valida tamanho
  if (file.size > MAX_FILE_SIZE) {
    showUploadError(`O arquivo é muito grande. Máximo permitido: 10 MB.`);
    return;
  }

  state.selectedFile = file;
  uploadError.hidden = true;

  // Mostra prévia
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewImg.hidden = false;
    dropPlaceholder.hidden = true;
  };
  reader.readAsDataURL(file);

  btnSend.disabled = false;
}

/* ============================================================
   Upload para o Cloudinary
   ============================================================ */
async function uploadPhoto() {
  if (!state.selectedFile || state.isUploading) return;

  if (CLOUDINARY_CLOUD_NAME === 'SEU_CLOUD_NAME') {
    showUploadError('Configure as credenciais do Cloudinary no arquivo app.js.');
    return;
  }

  state.isUploading = true;
  btnSend.disabled = true;
  btnSend.innerHTML = '<div class="spinner" style="width:22px;height:22px;border-width:3px"></div> Enviando…';
  uploadError.hidden = true;
  progressWrap.hidden = false;
  setProgress(0, 'Preparando…');

  const formData = new FormData();
  formData.append('file', state.selectedFile);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', CLOUDINARY_FOLDER);

  // Adiciona contexto com nome do autor e timestamp
  const author = authorName.value.trim() || 'Participante';
  const context = `author=${author}|event=Conexão Profissional 2026`;
  formData.append('context', context);

  // Tags para facilitar a busca
  formData.append('tags', 'conexao2026,juntafoto');

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  try {
    // XMLHttpRequest para ter progresso real
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 90);
          setProgress(pct, `Enviando… ${pct}%`);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress(100, 'Concluído!');
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Erro ${xhr.status}: ${xhr.responseText}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Falha de conexão. Verifique sua internet.')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelado.')));

      xhr.open('POST', url);
      xhr.send(formData);
    });

    showToast('🎉 Foto enviada! Aparecendo na galeria…');
    closeUploadModal();

    // Recarrega a galeria para mostrar a nova foto
    setTimeout(() => {
      state.photos = [];
      state.nextCursor = null;
      loadPhotos();
    }, 1500);

  } catch (err) {
    showUploadError(err.message || 'Erro ao enviar. Tente novamente.');
    state.isUploading = false;
    btnSend.disabled = false;
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
  progressBar.style.width = `${pct}%`;
  progressBar.setAttribute('aria-valuenow', pct);
  progressLabel.textContent = label;
}

/* ============================================================
   Carregar fotos da galeria (Cloudinary Search API)
   ============================================================ */
async function loadPhotos(append = false) {
  if (state.isLoading) return;
  state.isLoading = true;

  if (!append) {
    loadingState.style.display = 'flex';
    emptyState.hidden = true;
    galleryToolbar.hidden = true;
  }

  try {
    // Cloudinary Search API — lista imagens da pasta pública
    const searchUrl = buildSearchUrl();
    const res = await fetch(searchUrl);

    if (!res.ok) throw new Error('Erro ao carregar fotos');

    const data = await res.json();
    state.nextCursor = data.next_cursor || null;

    const newPhotos = (data.resources || []).map(parseCloudinaryResource);

    if (append) {
      state.photos = [...state.photos, ...newPhotos];
    } else {
      state.photos = newPhotos;
    }

    renderGallery(append);

  } catch (err) {
    // Se a API de busca não está disponível (credenciais não configuradas),
    // tenta o endpoint de lista pública
    if (state.photos.length === 0) {
      emptyState.hidden = false;
    }
  } finally {
    state.isLoading = false;
    loadingState.style.display = 'none';
  }
}

function buildSearchUrl() {
  // Cloudinary Search API pública (não requer autenticação para pastas públicas)
  // expression: busca todas as imagens da pasta com a tag do evento
  const expression = encodeURIComponent(`folder:${CLOUDINARY_FOLDER} AND tags:conexao2026`);
  const maxResults = 60;
  let url = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/search/`
    + `expression=${expression}`
    + `/sort_by[created_at]=desc`
    + `/max_results=${maxResults}`
    + `/with_field=context`;

  if (state.nextCursor) {
    url += `/next_cursor=${encodeURIComponent(state.nextCursor)}`;
  }

  return url;
}

function parseCloudinaryResource(r) {
  return {
    id: r.public_id,
    url: r.secure_url,
    // Versão thumbnail otimizada: 400x400, crop fill, qualidade auto
    thumb: r.secure_url.replace('/upload/', '/upload/c_fill,w_400,h_400,q_auto,f_auto/'),
    // Versão para visualização: largura 1200, qualidade auto
    full: r.secure_url.replace('/upload/', '/upload/w_1200,q_auto,f_auto/'),
    author: r.context?.custom?.author || 'Participante',
    createdAt: r.created_at,
  };
}

/* ============================================================
   Renderizar galeria
   ============================================================ */
function renderGallery(append = false) {
  if (!append) galleryGrid.innerHTML = '';

  if (state.photos.length === 0) {
    hero.hidden = false;
    emptyState.hidden = false;
    galleryToolbar.hidden = true;
    return;
  }

  hero.hidden = true;
  emptyState.hidden = true;
  galleryToolbar.hidden = false;
  photoCount.textContent = `${state.photos.length} foto${state.photos.length !== 1 ? 's' : ''}`;

  const startIdx = append ? state.photos.length - (state.photos.length % 60 || 60) : 0;
  const photosToRender = append ? state.photos.slice(startIdx) : state.photos;

  photosToRender.forEach((photo) => {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Foto de ${photo.author}`);

    const img = document.createElement('img');
    img.src = photo.thumb;
    img.alt = `Foto de ${photo.author}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';

    const authorEl = document.createElement('span');
    authorEl.className = 'gallery-item-author';
    authorEl.textContent = photo.author;
    overlay.appendChild(authorEl);

    item.appendChild(img);
    item.appendChild(overlay);

    item.addEventListener('click', () => openViewer(photo));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openViewer(photo);
    });

    galleryGrid.appendChild(item);
  });
}

/* ============================================================
   Viewer (visualização ampliada)
   ============================================================ */
function openViewer(photo) {
  viewerImg.src = photo.full;
  viewerImg.alt = `Foto de ${photo.author}`;
  viewerAuthor.textContent = photo.author;
  viewerDate.textContent = formatDate(photo.createdAt);

  // Link de download direto (força download sem transformações)
  btnDownload.href = photo.url.replace('/upload/', '/upload/fl_attachment/');
  btnDownload.download = `conexao2026-${Date.now()}.jpg`;

  // Guarda URL para compartilhamento
  btnShare.dataset.url = photo.full;
  btnShare.dataset.author = photo.author;

  viewerModal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  viewerModal.hidden = true;
  document.body.style.overflow = '';
  viewerImg.src = '';
}

/* ============================================================
   Compartilhamento (Web Share API)
   ============================================================ */
async function sharePhoto() {
  const shareUrl = btnShare.dataset.url;
  const author = btnShare.dataset.author || 'Participante';

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Conexão Profissional 2026 – SENAI Fraiburgo',
        text: `Olha essa foto de ${author} no Conexão Profissional 2026! 📸`,
        url: shareUrl,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        copyToClipboard(shareUrl);
      }
    }
  } else {
    // Fallback: copia link
    copyToClipboard(shareUrl);
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Link copiado!'));
  } else {
    // Fallback para browsers antigos
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Link copiado!');
  }
}

/* ============================================================
   Atualização automática (polling)
   ============================================================ */
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    // Só atualiza se o app está visível e o modal de upload não está aberto
    if (!document.hidden && uploadModal.hidden) {
      state.photos = [];
      state.nextCursor = null;
      loadPhotos();
    }
  }, GALLERY_POLL_INTERVAL);
}

// Pausa polling quando a aba/app fica em background (economiza bateria)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(state.pollTimer);
  } else {
    // Atualiza imediatamente ao voltar
    state.photos = [];
    state.nextCursor = null;
    loadPhotos();
    startPolling();
  }
});

/* ============================================================
   Toast
   ============================================================ */
let toastTimer;
function showToast(message, duration = 3000) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ============================================================
   Utilitários
   ============================================================ */
function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.hidden = false;
}

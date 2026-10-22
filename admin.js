/* ============================================================
   JuntaFoto · Painel do administrador
   Conversa com /api/admin (que guarda o segredo do Cloudinary).
   ============================================================ */

const CLOUDINARY_CLOUD_NAME    = 'vyodkyhe';
const CLOUDINARY_UPLOAD_PRESET = 'juntafoto_preset';
const CLOUDINARY_FOLDER        = 'conexao2026';
const BATCH_SIZE   = 100;  // fotos por requisição (cada chamada da Vercel tem limite de tempo)
const RENDER_STEP  = 120;  // fotos desenhadas por vez na grade
const NO_ALBUM     = '__none';

const S = {
  token:       sessionStorage.getItem('jf_admin_token') || '',
  photos:      [],
  config:      null,
  selected:    new Set(),
  filtered:    [],
  renderLimit: RENDER_STEP,
  editList:    [],
  editIndex:   -1,
  editAngle:   0,
  albumEditing: null,
  albumCover:  '',
  uploadFiles: [],
};

const $ = (id) => document.getElementById(id);

/* Cria elementos com segurança (texto sempre via textContent — nunca HTML de participantes) */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

/* ============================================================
   API
   ============================================================ */
async function api(action, body = {}) {
  const res = await fetch('/api/admin', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` },
    body:    JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.expired) {
    logout();
    throw new Error(data.error);
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Erro ${res.status}`), { data });
  return data;
}

async function inBatches(ids, fn) {
  for (let i = 0; i < ids.length; i += BATCH_SIZE) await fn(ids.slice(i, i + BATCH_SIZE), i);
}

/* ============================================================
   LOGIN
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle((msg) => toast(msg)); // tema claro/escuro/automático (tema.js)
  bindEvents();
  bindBranding();
  if (S.token) enter();
  else $('adminPassword').focus();
});

async function login(e) {
  e.preventDefault();
  const btn = $('btnLogin');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  $('loginError').hidden = true;
  try {
    const res  = await fetch('/api/admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'login', email: $('adminEmail').value.trim(), password: $('adminPassword').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.notConfigured) $('setupBox').hidden = false;
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    S.token = data.token;
    sessionStorage.setItem('jf_admin_token', S.token);
    sessionStorage.setItem('jf_admin_email', data.email);
    $('adminPassword').value = '';
    enter();
    if (data.firstAccess) toast(`Bem-vindo! ${data.email} foi cadastrado como administrador.`);
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function logout() {
  S.token = '';
  sessionStorage.removeItem('jf_admin_token');
  sessionStorage.removeItem('jf_admin_email');
  $('adminApp').hidden    = true;
  $('loginScreen').hidden = false;
  document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
}

function enter() {
  $('loginScreen').hidden = true;
  $('adminApp').hidden    = false;
  $('adminWho').textContent = sessionStorage.getItem('jf_admin_email') || 'Administrador';
  loadAll();
}

async function loadAll() {
  $('loading').hidden = false;
  try {
    const r = await api('list');
    S.photos = r.photos;
    S.config = r.config;
    $('truncatedNotice').hidden = !r.truncated;
    S.selected.clear();
    fillEventForm();
    renderAll();
  } catch (err) {
    if (S.token) toast(err.message, true);
  } finally {
    $('loading').hidden = true;
  }
  api('usage').then(renderUsage).catch(() => { $('usage').textContent = 'Informação indisponível.'; });
}

/* ============================================================
   EVENTOS
   ============================================================ */
function bindEvents() {
  $('loginForm').addEventListener('submit', login);
  $('btnLogout').addEventListener('click', logout);

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  /* Fechar modais (botão ✕, clique fora, Esc) */
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m); });
  });
  document.addEventListener('keydown', onKeydown);

  /* Visão geral */
  $('qaUpload').addEventListener('click', openUpload);
  $('qaPending').addEventListener('click', () => filterAndShow({ status: 'pending' }));
  $('qaZipAll').addEventListener('click', () => downloadZip({ name: 'conexao2026-todas' }));
  $('qaCsv').addEventListener('click', exportCsv);
  $('qaToggleUploads').addEventListener('click', () => saveConfig({ uploadsOpen: !S.config.uploadsOpen }));

  /* Fotos */
  ['fSearch', 'fAlbum', 'fStatus', 'fSort'].forEach((id) => $(id).addEventListener('input', () => { S.renderLimit = RENDER_STEP; renderPhotos(); }));
  $('btnUpload').addEventListener('click', openUpload);
  $('btnReload').addEventListener('click', loadAll);
  $('btnSelectAll').addEventListener('click', toggleSelectAll);
  document.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulk(b.dataset.bulk)));
  $('bulkAlbum').addEventListener('change', () => { const v = $('bulkAlbum').value; $('bulkAlbum').value = ''; if (v) bulkMove(v); });

  /* Editor */
  $('editorForm').addEventListener('submit', saveEditor);
  $('edPrev').addEventListener('click', () => stepEditor(-1));
  $('edNext').addEventListener('click', () => stepEditor(1));
  $('edRotL').addEventListener('click', () => rotateEditor(-90));
  $('edRotR').addEventListener('click', () => rotateEditor(90));
  $('edDelete').addEventListener('click', deleteFromEditor);
  $('edCopy').addEventListener('click', () => copyText(photoUrl(currentPhoto(), 'q_auto,f_auto', S.editAngle)));
  $('edCover').addEventListener('click', setCoverFromEditor);

  /* Álbuns */
  $('albumForm').addEventListener('submit', createAlbum);
  $('albumEditForm').addEventListener('submit', saveAlbumEdit);

  /* Configurações */
  $('settingsForm').addEventListener('submit', saveSettings);
  $('btnDeleteAll').addEventListener('click', deleteAll);

  /* Upload */
  $('upFiles').addEventListener('change', () => addUploadFiles($('upFiles').files));
  const drop = $('upDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('dragover'); addUploadFiles(e.dataTransfer.files); });
  $('upStart').addEventListener('click', startUpload);

  /* Colagem */
  let typing;
  ['clTitle', 'clSubtitle'].forEach((id) => $(id).addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(drawCollage, 300); }));
  $('clBadge').addEventListener('change', drawCollage);
  $('clShuffle').addEventListener('click', () => { S.collage.photos.sort(() => Math.random() - 0.5); renderCollageOrder(); drawCollage(); });
  $('clDownload').addEventListener('click', downloadCollage);
  $('clShare').addEventListener('click', shareCollage);
  $('clPublish').addEventListener('click', publishCollage);
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    const open = [...document.querySelectorAll('.modal')].reverse().find((m) => !m.hidden);
    if (open && open.id !== 'confirmModal') closeModal(open);
    return;
  }
  if (!$('editorModal').hidden && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    if (e.key === 'ArrowLeft')  stepEditor(-1);
    if (e.key === 'ArrowRight') stepEditor(1);
  }
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `panel-${tab}`; });
  window.scrollTo(0, 0);
}

function openModal(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(m) {
  m.hidden = true;
  if (![...document.querySelectorAll('.modal')].some((x) => !x.hidden)) document.body.style.overflow = '';
}

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
function photoUrl(p, transform, angle = p.angle) {
  const rotate = angle ? `a_${angle}/` : '';
  return p.url.replace('/upload/', `/upload/${rotate}${transform}/`);
}
const thumbUrl = (p, size = 300) => photoUrl(p, `c_fill,w_${size},h_${size},q_auto,f_auto`);

const albumById   = (id) => (S.config?.albums || []).find((a) => a.id === id);
const albumName   = (id) => albumById(id)?.name || id;
const inHiddenAlbum = (p) => p.albums.some((id) => albumById(id)?.hidden);
const isPublic    = (p) => !p.hidden && !p.pending && !inHiddenAlbum(p);
const norm        = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

function formatBytes(b) {
  if (!b) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[i]}`;
}

const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 6000 : 3000);
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Link copiado!'), () => toast('Não foi possível copiar.', true));
}

/* Executa uma ação mostrando erro amigável */
async function run(label, fn) {
  try {
    await fn();
  } catch (err) {
    toast(`${label}: ${err.message}`, true);
  }
}

/* Confirmação com caixa própria (opcionalmente com checkbox ou campo de texto) */
function confirmDialog({ title, message, okText = 'Confirmar', danger = false, checkbox = null, input = null }) {
  return new Promise((resolve) => {
    $('cfTitle').textContent   = title;
    $('cfMessage').textContent = message || '';
    $('cfCheckWrap').hidden    = !checkbox;
    $('cfCheck').checked       = false;
    if (checkbox) $('cfCheckLabel').textContent = checkbox;
    const inp = $('cfInput');
    inp.hidden      = !input;
    inp.value       = input?.value || '';
    inp.placeholder = input?.placeholder || '';
    const ok = $('cfOk');
    ok.textContent = okText;
    ok.className   = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    openModal('confirmModal');
    if (input) setTimeout(() => inp.focus(), 50);

    const done = (result) => {
      closeModal($('confirmModal'));
      ok.removeEventListener('click', onOk);
      $('cfCancel').removeEventListener('click', onCancel);
      inp.removeEventListener('keydown', onEnter);
      resolve(result);
    };
    const onOk = () => {
      if (input?.mustEqual && inp.value.trim() !== input.mustEqual) { toast(`Digite ${input.mustEqual} para confirmar.`, true); return; }
      done({ checked: $('cfCheck').checked, value: inp.value.trim() });
    };
    const onCancel = () => done(null);
    const onEnter  = (e) => { if (e.key === 'Enter') onOk(); };
    ok.addEventListener('click', onOk);
    $('cfCancel').addEventListener('click', onCancel);
    inp.addEventListener('keydown', onEnter);
  });
}

/* ============================================================
   RENDERIZAÇÃO GERAL
   ============================================================ */
function renderAll() {
  $('tabCountPhotos').textContent = S.photos.length;
  $('tabCountAlbums').textContent = S.config.albums.length;
  $('tabCountFrames').textContent = S.config.frames.length;
  applyEventTheme(S.config.event); // o painel também usa as cores do evento
  renderAlbumSelects();
  renderOverview();
  renderPhotos();
  renderAlbums();
  renderSettings();
  renderFrames();
}

function renderAlbumSelects() {
  const albums = S.config.albums;
  const fill = (sel, first, extra = []) => {
    const keep = sel.value;
    sel.replaceChildren(...first.map(([v, t]) => h('option', { value: v, text: t })),
      ...albums.map((a) => h('option', { value: a.id, text: a.name + (a.hidden ? ' (oculto)' : '') })), ...extra);
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  };
  fill($('fAlbum'), [['', 'Todos os álbuns'], [NO_ALBUM, 'Sem álbum']]);
  fill($('bulkAlbum'), [['', '📁 Mover para álbum…'], [NO_ALBUM, 'Tirar do álbum']]);
  fill($('edAlbum'), [['', 'Sem álbum']]);
  fill($('upAlbum'), [['', 'Sem álbum']]);
  fill($('clAlbum'), [['', 'Sem álbum']]);
  fill($('sDefaultAlbum'), [['', 'Nenhum']]);
}

/* ============================================================
   VISÃO GERAL
   ============================================================ */
function renderOverview() {
  const P = S.photos;
  const today = new Date().toDateString();
  const authors = new Map();
  P.forEach((p) => authors.set(p.author, (authors.get(p.author) || 0) + 1));
  const pending = P.filter((p) => p.pending).length;

  const stats = [
    ['Total de fotos',          P.length,                                   {}],
    ['Visíveis na galeria',     P.filter(isPublic).length,                  { status: 'visible' }],
    ['Pendentes de aprovação',  pending,                                    { status: 'pending' }, pending > 0],
    ['Ocultas',                 P.filter((p) => p.hidden).length,           { status: 'hidden' }],
    ['Destaques',               P.filter((p) => p.featured).length,         { status: 'featured' }],
    ['Enviadas hoje',           P.filter((p) => new Date(p.createdAt).toDateString() === today).length, null],
    ['Participantes',           authors.size,                               null],
    ['Álbuns',                  S.config.albums.length,                     null],
  ];
  $('stats').replaceChildren(...stats.map(([label, value, filter, warn]) =>
    h('button', {
      class: 'stat' + (warn ? ' warn' : ''),
      'data-filter': filter ? '1' : null,
      onclick: filter ? () => filterAndShow(filter) : null,
      type: 'button',
    }, h('span', { class: 'stat-value', text: value.toLocaleString('pt-BR') }), h('span', { class: 'stat-label', text: label }))));

  $('qaPending').textContent = pending ? `✅ Revisar pendentes (${pending})` : '✅ Revisar pendentes';
  $('qaPending').disabled    = pending === 0;
  $('qaToggleUploads').textContent = S.config.uploadsOpen ? '⏸️ Fechar envios' : '▶️ Abrir envios';

  const top = [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  $('ranking').replaceChildren(...(top.length
    ? top.map(([name, n]) => h('li', {}, h('button', { class: 'btn-link', type: 'button', text: name, onclick: () => filterAndShow({ search: name }) }), ' ', h('span', { text: `· ${plural(n, 'foto', 'fotos')}` })))
    : [h('li', { class: 'muted', text: 'Nenhuma foto ainda.' })]));

  const recent = P.slice(0, 18);
  $('recent').replaceChildren(...recent.map((p, i) => h('img', { src: thumbUrl(p, 140), alt: `Foto de ${p.author}`, loading: 'lazy', onclick: () => openEditor(recent, i) })));
  if (!recent.length) $('recent').replaceChildren(h('p', { class: 'muted', text: 'Nenhuma foto ainda.' }));
}

function renderUsage(u) {
  const rows = [h('div', { class: 'usage-row' }, h('span', { text: 'Fotos do evento' }), h('b', { text: formatBytes(S.photos.reduce((s, p) => s + (p.bytes || 0), 0)) }))];
  rows.push(h('div', { class: 'usage-row' }, h('span', { text: 'Armazenamento da conta' }), h('b', { text: formatBytes(u.storage) })));
  rows.push(h('div', { class: 'usage-row' }, h('span', { text: 'Tráfego no mês' }), h('b', { text: formatBytes(u.bandwidth) })));
  if (u.credits) {
    const pct = Math.min(100, Math.round(u.credits.percent || 0));
    rows.push(h('div', { class: 'usage-row' }, h('span', { text: 'Créditos usados' }), h('b', { text: `${pct}% (${u.credits.used} de ${u.credits.limit})` })));
    rows.push(h('div', { class: 'meter' }, h('div', { style: `width:${pct}%` })));
  }
  if (u.plan) rows.push(h('p', { class: 'muted', text: `Plano: ${u.plan}` }));
  $('usage').replaceChildren(...rows);
}

function filterAndShow({ status = '', album = '', search = '' }) {
  $('fStatus').value = status;
  $('fAlbum').value  = album;
  $('fSearch').value = search;
  S.renderLimit = RENDER_STEP;
  renderPhotos();
  showTab('photos');
}

/* ============================================================
   FOTOS
   ============================================================ */
function applyFilters() {
  const q      = norm($('fSearch').value.trim());
  const album  = $('fAlbum').value;
  const status = $('fStatus').value;
  const sort   = $('fSort').value;

  const list = S.photos.filter((p) => {
    if (q && !norm(`${p.author} ${p.caption}`).includes(q)) return false;
    if (album === NO_ALBUM && p.albums.length) return false;
    if (album && album !== NO_ALBUM && !p.albums.includes(album)) return false;
    if (status === 'visible'  && !isPublic(p)) return false;
    if (status === 'pending'  && !p.pending)   return false;
    if (status === 'hidden'   && !p.hidden)    return false;
    if (status === 'featured' && !p.featured)  return false;
    return true;
  });
  if (sort === 'old')    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sort === 'new')    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === 'author') list.sort((a, b) => a.author.localeCompare(b.author, 'pt-BR'));
  return list;
}

function photoBadges(p) {
  return [
    p.pending  && h('span', { class: 'badge pending',  text: 'Pendente' }),
    p.hidden   && h('span', { class: 'badge hidden',   text: 'Oculta' }),
    p.featured && h('span', { class: 'badge featured', text: '⭐ Destaque' }),
    ...p.albums.map((id) => h('span', { class: 'badge album', text: albumName(id) })),
  ].filter(Boolean);
}

function renderPhotos() {
  S.filtered = applyFilters();
  const grid = $('photoGrid');
  const shown = S.filtered.slice(0, S.renderLimit);

  $('resultCount').textContent = plural(S.filtered.length, 'foto', 'fotos');
  $('photosEmpty').hidden = S.filtered.length > 0;

  grid.replaceChildren(...shown.map((p, i) => h('div', {
    class: 'photo-card' + (S.selected.has(p.id) ? ' selected' : '') + (isPublic(p) ? '' : ' is-hidden'),
  },
    h('img', { src: thumbUrl(p), alt: `Foto de ${p.author}`, loading: 'lazy', onclick: () => openEditor(S.filtered, i) }),
    h('input', { type: 'checkbox', class: 'check', checked: S.selected.has(p.id), 'aria-label': 'Selecionar', onchange: (e) => toggleSelect(p.id, e.target) }),
    h('div', { class: 'badges' }, photoBadges(p)),
    h('div', { class: 'info' },
      h('div', { class: 'author', text: p.author, title: p.caption || p.author }),
      h('div', { class: 'date', text: formatDate(p.createdAt) })),
  )));

  if (S.filtered.length > S.renderLimit) {
    grid.appendChild(h('div', { style: 'grid-column:1/-1;text-align:center;padding:12px' },
      h('button', { class: 'btn', type: 'button', text: `Mostrar mais (${S.filtered.length - S.renderLimit} restantes)`, onclick: () => { S.renderLimit += RENDER_STEP * 2; renderPhotos(); } })));
  }
  updateBulkBar();
}

function toggleSelect(id, checkbox) {
  if (checkbox.checked) S.selected.add(id); else S.selected.delete(id);
  checkbox.closest('.photo-card').classList.toggle('selected', checkbox.checked);
  updateBulkBar();
}

function toggleSelectAll() {
  const allSelected = S.filtered.length > 0 && S.filtered.every((p) => S.selected.has(p.id));
  S.filtered.forEach((p) => (allSelected ? S.selected.delete(p.id) : S.selected.add(p.id)));
  renderPhotos();
}

function updateBulkBar() {
  // Ações em lote valem só para fotos visíveis no filtro atual (nunca para fotos escondidas pelo filtro)
  const ids = new Set(S.filtered.map((p) => p.id));
  [...S.selected].forEach((id) => { if (!ids.has(id)) S.selected.delete(id); });
  $('bulkBar').hidden = S.selected.size === 0;
  $('bulkCount').textContent = `${plural(S.selected.size, 'selecionada', 'selecionadas')}`;
  const allSelected = S.filtered.length > 0 && S.filtered.every((p) => S.selected.has(p.id));
  $('btnSelectAll').textContent = allSelected ? 'Desmarcar todas' : 'Selecionar todas';
}

/* ── Alterações em lote (aplica no Cloudinary e depois na lista local) ── */
async function changeTags(ids, add = [], remove = []) {
  if (!add.length && !remove.length) return;
  await inBatches(ids, (part) => api('tags', { ids: part, add, remove }));
  const set = new Set(ids);
  S.photos.forEach((p) => {
    if (!set.has(p.id)) return;
    const flags = { oculta: 'hidden', pendente: 'pending', destaque: 'featured' };
    for (const t of remove) { if (flags[t]) p[flags[t]] = false; else if (t.startsWith('album_')) p.albums = p.albums.filter((a) => a !== t.slice(6)); }
    for (const t of add)    { if (flags[t]) p[flags[t]] = true;  else if (t.startsWith('album_') && !p.albums.includes(t.slice(6))) p.albums.push(t.slice(6)); }
  });
}

async function updateContext(ids, fields) {
  await inBatches(ids, (part) => api('update', { ids: part, ...fields }));
  const set = new Set(ids);
  S.photos.forEach((p) => { if (set.has(p.id)) Object.assign(p, fields); });
}

async function deletePhotos(ids) {
  let done = 0;
  await inBatches(ids, async (part) => {
    await api('delete', { ids: part });
    done += part.length;
    if (ids.length > BATCH_SIZE) toast(`Excluindo… ${done} de ${ids.length}`);
  });
  const set = new Set(ids);
  S.photos = S.photos.filter((p) => !set.has(p.id));
  ids.forEach((id) => S.selected.delete(id));
  // Remove capas que apontavam para fotos excluídas
  if (S.config.albums.some((a) => set.has(a.cover))) {
    await saveConfig({ albums: S.config.albums.map((a) => (set.has(a.cover) ? { ...a, cover: '' } : a)) }, true);
  }
}

async function bulk(action) {
  const ids = [...S.selected];
  if (action === 'clear') { S.selected.clear(); renderPhotos(); return; }
  if (!ids.length) return;
  if (action === 'collage') {
    if (ids.length < 2 || ids.length > COLLAGE_MAX) { toast(`Selecione de 2 a ${COLLAGE_MAX} fotos para a colagem.`, true); return; }
    openCollage(S.filtered.filter((p) => S.selected.has(p.id))); // na ordem em que aparecem na tela
    return;
  }

  await run('Não foi possível concluir', async () => {
    switch (action) {
      case 'approve':   await changeTags(ids, [], ['pendente']);  toast(`${plural(ids.length, 'foto aprovada', 'fotos aprovadas')}.`); break;
      case 'show':      await changeTags(ids, [], ['oculta']);    toast(`${plural(ids.length, 'foto visível', 'fotos visíveis')}.`); break;
      case 'hide':      await changeTags(ids, ['oculta'], []);    toast(`${plural(ids.length, 'foto oculta', 'fotos ocultas')}.`); break;
      case 'feature':   await changeTags(ids, ['destaque'], []);  toast('Marcadas como destaque.'); break;
      case 'unfeature': await changeTags(ids, [], ['destaque']);  toast('Destaque removido.'); break;
      case 'zip':       await downloadZip({ ids, name: 'conexao2026-selecao' }); return;
      case 'author': {
        const r = await confirmDialog({ title: 'Alterar autor', message: `Novo nome de autor para ${plural(ids.length, 'foto', 'fotos')}:`, okText: 'Alterar', input: { placeholder: 'Nome do autor' } });
        if (!r || !r.value) return;
        await updateContext(ids, { author: r.value });
        toast('Autor alterado.');
        break;
      }
      case 'delete': {
        const r = await confirmDialog({ title: `Excluir ${plural(ids.length, 'foto', 'fotos')}?`, message: 'As fotos serão apagadas do Cloudinary definitivamente. Não tem como desfazer.', okText: 'Excluir', danger: true });
        if (!r) return;
        await deletePhotos(ids);
        toast(`${plural(ids.length, 'foto excluída', 'fotos excluídas')}.`);
        break;
      }
    }
    renderAll();
  });
}

/* Cada foto fica em um álbum só: tira dos outros e coloca no escolhido */
async function moveToAlbum(ids, albumId) {
  const photos = S.photos.filter((p) => ids.includes(p.id));
  const current = [...new Set(photos.flatMap((p) => p.albums))].filter((a) => a !== albumId);
  const add = albumId && albumId !== NO_ALBUM ? [`album_${albumId}`] : [];
  await changeTags(ids, add, current.map((a) => `album_${a}`));
}

async function bulkMove(albumId) {
  const ids = [...S.selected];
  await run('Não foi possível mover', async () => {
    await moveToAlbum(ids, albumId);
    toast(albumId === NO_ALBUM ? 'Fotos retiradas do álbum.' : `Movidas para "${albumName(albumId)}".`);
    renderAll();
  });
}

async function downloadZip({ ids, album, name }) {
  await run('Não foi possível gerar o .zip', async () => {
    toast('Preparando o arquivo .zip…');
    const { url } = await api('zip', { ids, album, name });
    window.open(url, '_blank', 'noopener');
  });
}

function exportCsv() {
  const cols = ['Autor', 'Legenda', 'Álbum', 'Situação', 'Destaque', 'Enviada em', 'Largura', 'Altura', 'Tamanho (KB)', 'Link'];
  const esc  = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = S.photos.map((p) => [
    p.author, p.caption, p.albums.map(albumName).join(', '),
    p.pending ? 'Pendente' : p.hidden ? 'Oculta' : inHiddenAlbum(p) ? 'Álbum oculto' : 'Visível',
    p.featured ? 'Sim' : 'Não', formatDate(p.createdAt), p.width, p.height, Math.round((p.bytes || 0) / 1024), p.url,
  ]);
  const csv  = '\ufeff' + [cols, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  const link = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `fotos-conexao2026-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* ============================================================
   EDITOR DE FOTO
   ============================================================ */
const currentPhoto = () => S.editList[S.editIndex];

function openEditor(list, index) {
  S.editList  = list.slice();
  S.editIndex = index;
  fillEditor();
  openModal('editorModal');
}

function fillEditor() {
  const p = currentPhoto();
  if (!p) { closeModal($('editorModal')); return; }
  S.editAngle = p.angle || 0;
  $('edImg').src = photoUrl(p, 'w_1400,q_auto,f_auto', S.editAngle);
  $('edImg').alt = `Foto de ${p.author}`;
  $('edAuthor').value  = p.author;
  $('edCaption').value = p.caption;
  $('edAlbum').value   = p.albums[0] || '';
  $('edVisible').checked  = !p.hidden;
  $('edApproved').checked = !p.pending;
  $('edFeatured').checked = p.featured;
  $('edBadges').replaceChildren(...photoBadges(p));
  $('edMeta').replaceChildren(
    h('dt', { text: 'Enviada' }),    h('dd', { text: formatDate(p.createdAt) }),
    h('dt', { text: 'Tamanho' }),    h('dd', { text: `${p.width} × ${p.height} · ${formatBytes(p.bytes)}` }),
    h('dt', { text: 'Na galeria' }), h('dd', { text: isPublic(p) ? 'Sim' : 'Não' }),
    h('dt', { text: 'ID' }),         h('dd', { text: p.id }),
  );
  $('edDownload').href = photoUrl(p, 'fl_attachment', S.editAngle);
  $('edCover').hidden  = !p.albums[0];
  $('edPrev').hidden   = S.editIndex <= 0;
  $('edNext').hidden   = S.editIndex >= S.editList.length - 1;
}

function stepEditor(dir) {
  const next = S.editIndex + dir;
  if (next < 0 || next >= S.editList.length) return;
  S.editIndex = next;
  fillEditor();
}

function rotateEditor(delta) {
  S.editAngle = ((S.editAngle + delta) % 360 + 360) % 360;
  $('edImg').src = photoUrl(currentPhoto(), 'w_1400,q_auto,f_auto', S.editAngle);
}

async function saveEditor(e) {
  e.preventDefault();
  const p = currentPhoto();
  const fields = {};
  const author  = $('edAuthor').value.trim() || 'Participante';
  const caption = $('edCaption').value.trim();
  if (author  !== p.author)  fields.author  = author;
  if (caption !== p.caption) fields.caption = caption;
  if (S.editAngle !== (p.angle || 0)) fields.angle = S.editAngle;

  const add = [], remove = [];
  const flag = (checked, wasOn, tag) => { if (checked && !wasOn) add.push(tag); if (!checked && wasOn) remove.push(tag); };
  flag(!$('edVisible').checked,  p.hidden,   'oculta');
  flag(!$('edApproved').checked, p.pending,  'pendente');
  flag($('edFeatured').checked,  p.featured, 'destaque');
  const newAlbum = $('edAlbum').value;

  await run('Não foi possível salvar', async () => {
    if (Object.keys(fields).length) await updateContext([p.id], fields);
    if (add.length || remove.length) await changeTags([p.id], add, remove);
    if (newAlbum !== (p.albums[0] || '') || p.albums.length > 1) await moveToAlbum([p.id], newAlbum || NO_ALBUM);
    toast('Foto salva.');
    renderAll();
    fillEditor();
  });
}

async function deleteFromEditor() {
  const p = currentPhoto();
  const r = await confirmDialog({ title: 'Excluir esta foto?', message: `Foto de ${p.author}. Ela será apagada do Cloudinary definitivamente.`, okText: 'Excluir', danger: true });
  if (!r) return;
  await run('Não foi possível excluir', async () => {
    await deletePhotos([p.id]);
    S.editList.splice(S.editIndex, 1);
    if (S.editIndex >= S.editList.length) S.editIndex = S.editList.length - 1;
    toast('Foto excluída.');
    renderAll();
    fillEditor();
  });
}

async function setCoverFromEditor() {
  const p = currentPhoto();
  const albumId = p.albums[0];
  if (!albumId) return;
  await saveConfig({ albums: S.config.albums.map((a) => (a.id === albumId ? { ...a, cover: p.id } : a)) });
  toast(`Capa do álbum "${albumName(albumId)}" atualizada.`);
}

/* ============================================================
   ÁLBUNS
   ============================================================ */
function albumPhotos(id) {
  return id === NO_ALBUM ? S.photos.filter((p) => p.albums.length === 0) : S.photos.filter((p) => p.albums.includes(id));
}

function renderAlbums() {
  const albums = S.config.albums;
  const cards = albums.map((a, i) => {
    const photos = albumPhotos(a.id);
    const cover  = S.photos.find((p) => p.id === a.cover) || photos[0];
    return h('div', { class: 'album-card' },
      h('div', { class: 'album-cover' }, cover ? h('img', { src: thumbUrl(cover, 500), alt: '', loading: 'lazy' }) : '📁'),
      h('div', { class: 'album-body' },
        h('div', { class: 'badges', style: 'margin-bottom:6px' },
          a.hidden && h('span', { class: 'badge hidden', text: 'Oculto' }),
          S.config.defaultAlbum === a.id && h('span', { class: 'badge album', text: 'Padrão para envios' })),
        h('h4', { text: a.name }),
        h('p', { text: plural(photos.length, 'foto', 'fotos') + (a.description ? ` · ${a.description}` : '') })),
      h('div', { class: 'album-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Ver fotos', onclick: () => filterAndShow({ album: a.id }) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Editar', onclick: () => openAlbumEdit(a.id) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: '↑', title: 'Mover para cima', disabled: i === 0, onclick: () => moveAlbum(i, -1) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: '↓', title: 'Mover para baixo', disabled: i === albums.length - 1, onclick: () => moveAlbum(i, 1) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: '⬇️ .zip', disabled: photos.length === 0, onclick: () => downloadZip({ album: a.id, name: `conexao2026-${a.id}` }) }),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Excluir', onclick: () => deleteAlbum(a.id) })));
  });

  const loose = albumPhotos(NO_ALBUM);
  cards.push(h('div', { class: 'album-card' },
    h('div', { class: 'album-cover' }, loose[0] ? h('img', { src: thumbUrl(loose[0], 500), alt: '', loading: 'lazy' }) : '🗂️'),
    h('div', { class: 'album-body' }, h('h4', { text: 'Sem álbum' }), h('p', { text: plural(loose.length, 'foto', 'fotos') })),
    h('div', { class: 'album-actions' }, h('button', { class: 'btn btn-sm', type: 'button', text: 'Ver fotos', onclick: () => filterAndShow({ album: NO_ALBUM }) }))));

  $('albumGrid').replaceChildren(...cards);
}

function slugify(name) {
  const base = norm(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'album';
  return `${base}_${Math.random().toString(36).slice(2, 6)}`;
}

async function createAlbum(e) {
  e.preventDefault();
  const name = $('newAlbumName').value.trim();
  if (!name) return;
  const album = { id: slugify(name), name, description: $('newAlbumDesc').value.trim(), hidden: false, cover: '' };
  await saveConfig({ albums: [...S.config.albums, album] });
  $('newAlbumName').value = '';
  $('newAlbumDesc').value = '';
  toast(`Álbum "${name}" criado.`);
}

async function moveAlbum(index, dir) {
  const albums = S.config.albums.slice();
  const [a] = albums.splice(index, 1);
  albums.splice(index + dir, 0, a);
  await saveConfig({ albums });
}

function openAlbumEdit(id) {
  const a = albumById(id);
  S.albumEditing = id;
  S.albumCover   = a.cover;
  $('aeName').value      = a.name;
  $('aeDesc').value      = a.description;
  $('aeHidden').checked  = a.hidden;
  $('aeDefault').checked = S.config.defaultAlbum === id;
  const photos = albumPhotos(id).slice(0, 120);
  const pick = (pid) => {
    S.albumCover = pid;
    $('aeCovers').querySelectorAll('img').forEach((img) => img.classList.toggle('active', img.dataset.id === pid));
  };
  $('aeCovers').replaceChildren(...(photos.length
    ? photos.map((p) => h('img', { src: thumbUrl(p, 140), alt: '', loading: 'lazy', 'data-id': p.id, class: p.id === a.cover ? 'active' : '', onclick: () => pick(p.id) }))
    : [h('p', { class: 'muted', text: 'Coloque fotos neste álbum para escolher a capa.' })]));
  openModal('albumModal');
}

async function saveAlbumEdit(e) {
  e.preventDefault();
  const id = S.albumEditing;
  const albums = S.config.albums.map((a) => (a.id === id ? {
    ...a, name: $('aeName').value.trim() || a.name, description: $('aeDesc').value.trim(), hidden: $('aeHidden').checked, cover: S.albumCover,
  } : a));
  let defaultAlbum = S.config.defaultAlbum;
  if ($('aeDefault').checked) defaultAlbum = id;
  else if (defaultAlbum === id) defaultAlbum = '';
  if (await saveConfig({ albums, defaultAlbum })) {
    closeModal($('albumModal'));
    toast('Álbum salvo.');
  }
}

async function deleteAlbum(id) {
  const a = albumById(id);
  const photos = albumPhotos(id);
  const r = await confirmDialog({
    title:    `Excluir o álbum "${a.name}"?`,
    message:  photos.length ? `As ${plural(photos.length, 'foto', 'fotos')} dele ficam "Sem álbum", a menos que você marque abaixo.` : 'O álbum está vazio.',
    checkbox: photos.length ? `Excluir também as ${plural(photos.length, 'foto', 'fotos')} (definitivo)` : null,
    okText:   'Excluir álbum',
    danger:   true,
  });
  if (!r) return;
  await run('Não foi possível excluir o álbum', async () => {
    const ids = photos.map((p) => p.id);
    if (ids.length && r.checked) await deletePhotos(ids);
    else if (ids.length)         await changeTags(ids, [], [`album_${id}`]);
    await saveConfig({
      albums:       S.config.albums.filter((x) => x.id !== id),
      defaultAlbum: S.config.defaultAlbum === id ? '' : S.config.defaultAlbum,
    });
    toast('Álbum excluído.');
  });
}

/* ============================================================
   CONFIGURAÇÕES
   ============================================================ */
async function saveConfig(changes, silent = false) {
  try {
    const r = await api('saveConfig', { config: { ...S.config, ...changes } });
    S.config = r.config;
    renderAll();
    return true;
  } catch (err) {
    if (!silent) toast(`Não foi possível salvar: ${err.message}`, true);
    return false;
  }
}

function renderSettings() {
  const c = S.config;
  $('sPassword').value        = c.accessPassword;
  $('sSession').value         = c.sessionMinutes;
  $('sUploadsOpen').checked   = c.uploadsOpen;
  $('sModeration').checked    = c.moderation;
  $('sDefaultAlbum').value    = c.defaultAlbum;
  $('sFrames').checked        = c.framesEnabled;
  $('sHashtags').value        = c.hashtags;
  $('sCaption').value         = c.shareCaption;
  $('sAdmins').value          = c.adminEmails.join('\n');
}

async function saveSettings(e) {
  e.preventDefault();
  const ok = await saveConfig({
    accessPassword: $('sPassword').value.trim(),
    sessionMinutes: parseInt($('sSession').value, 10),
    uploadsOpen:    $('sUploadsOpen').checked,
    moderation:     $('sModeration').checked,
    defaultAlbum:   $('sDefaultAlbum').value,
    framesEnabled:  $('sFrames').checked,
    hashtags:       $('sHashtags').value.trim(),
    shareCaption:   $('sCaption').value.trim(),
    adminEmails:    adminEmailsFromForm(),
  });
  if (ok) toast('Configurações salvas. Os participantes recebem em até 1 minuto.');
}

async function deleteAll() {
  const r = await confirmDialog({
    title:   `Excluir TODAS as ${plural(S.photos.length, 'foto', 'fotos')}?`,
    message: 'Isso apaga todas as fotos do evento do Cloudinary e não tem como desfazer. Para confirmar, digite EXCLUIR.',
    okText:  'Excluir tudo',
    danger:  true,
    input:   { placeholder: 'EXCLUIR', mustEqual: 'EXCLUIR' },
  });
  if (!r) return;
  await run('Não foi possível excluir', async () => {
    await deletePhotos(S.photos.map((p) => p.id));
    toast('Todas as fotos foram excluídas.');
    renderAll();
  });
}

/* ============================================================
   ENVIAR FOTOS (direto ao Cloudinary, igual ao app)
   ============================================================ */
function openUpload() {
  S.uploadFiles = [];
  $('upFiles').value = '';
  $('upList').replaceChildren();
  $('upStart').disabled = true;
  $('upStart').textContent = 'Enviar';
  $('upAlbum').value = S.config.defaultAlbum || '';
  openModal('uploadModal');
}

function addUploadFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  files.forEach((file) => {
    const status = h('span', { class: 'muted', text: 'Aguardando' });
    S.uploadFiles.push({ file, status });
    $('upList').appendChild(h('li', {}, h('span', { text: file.name }), status));
  });
  $('upStart').disabled = S.uploadFiles.length === 0;
}

function parseUploaded(r) {
  const ctx  = r.context?.custom || r.context || {};
  const tags = r.tags || [];
  return {
    id: r.public_id, url: r.secure_url, width: r.width, height: r.height, bytes: r.bytes, createdAt: r.created_at,
    author: ctx.author || 'Participante', caption: ctx.caption || '', angle: 0,
    hidden: tags.includes('oculta'), pending: tags.includes('pendente'), featured: tags.includes('destaque'),
    albums: tags.filter((t) => t.startsWith('album_')).map((t) => t.slice(6)),
  };
}

/* Envia um arquivo ao Cloudinary com as marcações do evento e devolve a foto já no formato do painel */
async function uploadToCloudinary(file, { author, album = '', featured = false, extraTags = [] }) {
  const tags = [S.config.event.tag, 'juntafoto', 'autor_' + norm(author).replace(/[^a-z0-9]/g, '_').slice(0, 30), ...extraTags];
  if (album)    tags.push(`album_${album}`);
  if (featured) tags.push('destaque');
  const fd = new FormData();
  fd.append('file',          file);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('asset_folder',  CLOUDINARY_FOLDER);
  fd.append('folder',        CLOUDINARY_FOLDER);
  fd.append('tags',          tags.join(','));
  fd.append('context',       `author=${author.replace(/([|=\\])/g, '\\$1')}`);
  const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status}`);
  const photo = parseUploaded(data);
  S.photos.unshift(photo);
  return photo;
}

async function startUpload() {
  const author   = $('upAuthor').value.trim() || 'Organização';
  const album    = $('upAlbum').value;
  const featured = $('upFeatured').checked;

  $('upStart').disabled = true;
  let ok = 0;
  for (const item of S.uploadFiles) {
    if (item.done) continue;
    item.status.className = 'muted';
    item.status.textContent = 'Enviando…';
    try {
      await uploadToCloudinary(await prepareForUpload(item.file), { author, album, featured });
      item.done = true;
      item.status.className = 'ok';
      item.status.textContent = '✓ Enviada';
      ok++;
    } catch (err) {
      item.status.className = 'err';
      item.status.textContent = err.message;
    }
  }
  renderAll();
  const failed = S.uploadFiles.filter((i) => !i.done).length;
  toast(failed ? `${ok} enviadas, ${failed} com erro.` : `${plural(ok, 'foto enviada', 'fotos enviadas')}!`, failed > 0);
  $('upStart').disabled = failed === 0;
  $('upStart').textContent = failed ? 'Tentar de novo as que falharam' : 'Enviar';
}

/* ============================================================
   COLAGEM (várias fotos numa moldura só — desenho em colagem.js)
   ============================================================ */
S.collage = { photos: [], images: new Map(), format: 'feed', layout: 'grade', canvas: null, token: 0 };

function renderChips(container, items, current, onPick) {
  container.replaceChildren(...items.map((it) => h('button', {
    type: 'button', class: 'chip' + (it.id === current ? ' active' : ''), text: it.label,
    onclick: () => onPick(it.id),
  })));
}

function renderCollageControls() {
  renderChips($('clFormats'), COLLAGE_FORMATS, S.collage.format, (id) => { S.collage.format = id; renderCollageControls(); drawCollage(); });
  renderChips($('clLayouts'), COLLAGE_LAYOUTS, S.collage.layout, (id) => { S.collage.layout = id; renderCollageControls(); drawCollage(); });
}

function renderCollageOrder() {
  const list = S.collage.photos;
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; renderCollageOrder(); drawCollage(); };
  $('clOrder').replaceChildren(...list.map((p, i) => h('div', { class: 'order-item' },
    h('img', { src: thumbUrl(p, 120), alt: `Foto de ${p.author}` }),
    h('span', { class: 'order-n', text: i + 1 }),
    h('div', { class: 'order-btns' },
      h('button', { type: 'button', text: '◀', title: 'Mover para antes', disabled: i === 0, onclick: () => move(i, -1) }),
      h('button', { type: 'button', text: '▶', title: 'Mover para depois', disabled: i === list.length - 1, onclick: () => move(i, 1) })))));
}

function openCollage(photos) {
  S.collage.photos = photos.slice(0, COLLAGE_MAX);
  S.collage.canvas = null;
  $('clTitle').value    = eventInfo().fullName;
  $('clSubtitle').value = '';
  $('clBadge').checked  = true;
  $('clAlbum').value    = '';
  renderCollageControls();
  renderCollageOrder();
  openModal('collageModal');
  drawCollage();
}

/* Carrega cada foto uma vez só (com crossOrigin, para o canvas poder exportar) */
function collageImage(p) {
  const key = `${p.id}:${p.angle || 0}`;
  if (!S.collage.images.has(key)) S.collage.images.set(key, loadFrameImage(photoUrl(p, 'w_1200,q_auto')));
  return S.collage.images.get(key);
}

async function drawCollage() {
  const token = ++S.collage.token;
  $('clLoading').hidden = false;
  try {
    const images = await Promise.all(S.collage.photos.map(collageImage));
    const canvas = await renderCollage(images, {
      format:   S.collage.format,
      layout:   S.collage.layout,
      title:    $('clTitle').value.trim(),
      subtitle: $('clSubtitle').value.trim(),
      badge:    $('clBadge').checked,
      hashtags: S.config.hashtags,
      theme:    frameTheme(),
    });
    if (token !== S.collage.token) return;
    S.collage.canvas = canvas;
    const view = $('clCanvas');
    view.width  = canvas.width;
    view.height = canvas.height;
    view.getContext('2d').drawImage(canvas, 0, 0);
  } catch (err) {
    toast(err.message || 'Não foi possível montar a colagem.', true);
  } finally {
    if (token === S.collage.token) $('clLoading').hidden = true;
  }
}

const collageFilename = () => `colagem-${eventInfo().tag}-${Date.now()}.jpg`;

async function downloadCollage() {
  if (!S.collage.canvas) return;
  downloadBlob(await canvasToJpeg(S.collage.canvas), collageFilename());
}

async function shareCollage() {
  if (!S.collage.canvas) return;
  const caption = [S.config.shareCaption, S.config.hashtags].filter(Boolean).join('\n\n');
  try { await navigator.clipboard?.writeText(caption); } catch (_) { /* segue sem copiar */ }
  const r = await shareOrDownloadFramed(S.collage.canvas, { caption, filename: collageFilename() });
  if (r === 'downloaded') toast('Colagem baixada! A legenda foi copiada.');
}

async function publishCollage() {
  if (!S.collage.canvas) return;
  const btn = $('clPublish');
  btn.disabled = true;
  btn.textContent = 'Publicando…';
  await run('Não foi possível publicar', async () => {
    const blob = await canvasToJpeg(S.collage.canvas);
    await uploadToCloudinary(new File([blob], collageFilename(), { type: 'image/jpeg' }), {
      author: 'Organização', album: $('clAlbum').value, featured: $('clFeatured').checked, extraTags: ['colagem'],
    });
    renderAll();
    toast('Colagem publicada na galeria! 🎉');
  });
  btn.disabled = false;
  btn.textContent = '📤 Publicar colagem';
}

/* ============================================================
   EVENTO (nome, cores, logo) e MOLDURAS PERSONALIZADAS
   ============================================================ */
const eventInfo  = () => eventData(S.config.event);
const frameTheme = (frame) => buildFrameTheme(S.config.event, frame);

/* Paletas prontas para começar rápido (principal, destaque, texto escuro) */
const COLOR_PRESETS = [
  { name: 'Azul e laranja', primary: '#004098', accent: '#e8490f', dark: '#221f1f' },
  { name: 'Verde',          primary: '#0b6e4f', accent: '#f2b705', dark: '#1d2b24' },
  { name: 'Roxo',           primary: '#5b2a86', accent: '#ff7a59', dark: '#24182e' },
  { name: 'Vermelho',       primary: '#b3122e', accent: '#ffc845', dark: '#2a1215' },
  { name: 'Grafite e ouro', primary: '#1f2933', accent: '#d4a72c', dark: '#111111' },
  { name: 'Rosa',           primary: '#c2185b', accent: '#00bfa5', dark: '#2b1020' },
];

function adminEmailsFromForm() {
  return [...new Set($('sAdmins').value.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/* Foto de exemplo para as prévias: a mais recente visível, ou um quadro neutro se ainda não houver fotos */
let samplePromise = null;
function samplePhoto() {
  if (!samplePromise) {
    const p = S.photos.find((x) => !x.hidden);
    samplePromise = p
      ? loadFrameImage(photoUrl(p, 'w_1000,q_auto')).catch(placeholderPhoto)
      : placeholderPhoto();
  }
  return samplePromise;
}

function placeholderPhoto() {
  const c = Object.assign(document.createElement('canvas'), { width: 900, height: 1200 });
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 900, 1200);
  g.addColorStop(0, '#cfd8e3');
  g.addColorStop(1, '#8a9bb0');
  x.fillStyle = g;
  x.fillRect(0, 0, 900, 1200);
  x.fillStyle = 'rgba(255,255,255,.85)';
  x.font = '700 64px Poppins, Arial';
  x.textAlign = 'center';
  x.fillText('📸 Sua foto aqui', 450, 620);
  return loadFrameImage(c.toDataURL('image/jpeg', 0.9));
}

/* Copia um canvas grande para um canvas de prévia (o CSS reduz o tamanho na tela) */
function paintPreview(target, source) {
  target.width  = source.width;
  target.height = source.height;
  target.getContext('2d').drawImage(source, 0, 0);
}

/* ── Aba Evento ── */
let eventDraft = null;

function bindBranding() {
  ['evName', 'evYear', 'evPlace', 'evTagline', 'evPrimary', 'evAccent', 'evDark', 'evTag']
    .forEach((id) => $(id).addEventListener('input', () => { readEventForm(); previewEvent(); }));
  $('evLogoFile').addEventListener('change', uploadLogo);
  $('evLogoRemove').addEventListener('click', () => { eventDraft.logoUrl = ''; renderLogoBox(); previewEvent(); });
  $('eventForm').addEventListener('submit', saveEvent);
  $('evPresets').replaceChildren(...COLOR_PRESETS.map((p) => h('button', {
    type: 'button', class: 'preset', title: p.name, 'aria-label': `Paleta ${p.name}`,
    style: `background:linear-gradient(135deg, ${p.primary} 0 60%, ${p.accent} 60% 100%)`,
    onclick: () => { Object.assign(eventDraft, { primary: p.primary, accent: p.accent, dark: p.dark }); fillEventForm(eventDraft); },
  })));

  $('btnNewFrame').addEventListener('click', () => openFrameEditor(null));
  $('frameForm').addEventListener('submit', saveFrame);
  ['frName', 'frPrimary', 'frAccent', 'frTitle', 'frSubtitle', 'frBadge']
    .forEach((id) => $(id).addEventListener('input', () => { readFrameForm(); previewFrame(); }));
  $('frUseEvent').addEventListener('change', () => { readFrameForm(); syncFrameColors(); readFrameForm(); previewFrame(); });
  $('frEnabled').addEventListener('change', readFrameForm);
}

function fillEventForm(ev = S.config.event) {
  eventDraft = { ...ev };
  $('evName').value    = ev.name;
  $('evYear').value    = ev.year;
  $('evPlace').value   = ev.place;
  $('evTagline').value = ev.tagline;
  $('evPrimary').value = ev.primary.toLowerCase();
  $('evAccent').value  = ev.accent.toLowerCase();
  $('evDark').value    = ev.dark.toLowerCase();
  $('evTag').value     = ev.tag;
  renderLogoBox();
  previewEvent();
}

function readEventForm() {
  Object.assign(eventDraft, {
    name:    $('evName').value.trim(),
    year:    $('evYear').value.trim(),
    place:   $('evPlace').value.trim(),
    tagline: $('evTagline').value.trim(),
    primary: $('evPrimary').value,
    accent:  $('evAccent').value,
    dark:    $('evDark').value,
    tag:     $('evTag').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''),
  });
}

function renderLogoBox() {
  $('evLogoPreview').hidden = !eventDraft.logoUrl;
  if (eventDraft.logoUrl) $('evLogoPreview').src = eventDraft.logoUrl;
  $('evLogoNone').hidden    = !!eventDraft.logoUrl;
  $('evLogoRemove').hidden  = !eventDraft.logoUrl;
}

let previewTimer;
function previewEvent() {
  const e = eventData(eventDraft);
  const box = $('evAppPreview');
  box.style.setProperty('--p', e.primary);
  box.style.setProperty('--a', e.accent);
  $('apSub').textContent = e.fullName;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const canvas = await renderFrame(await samplePhoto(), {
      template: 'classica', badge: true, hashtags: S.config.hashtags, theme: buildFrameTheme(eventDraft, {}),
    });
    paintPreview($('evFramePreview'), canvas);
  }, 250);
}

async function uploadLogo() {
  const file = $('evLogoFile').files[0];
  $('evLogoFile').value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('O logo deve ter até 5 MB.', true); return; }
  await run('Não foi possível enviar o logo', async () => {
    toast('Enviando logo…');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    fd.append('asset_folder', 'juntafoto_logos');
    fd.append('folder', 'juntafoto_logos');
    fd.append('tags', 'juntafoto_logo'); // sem a tag do evento: não aparece na galeria
    const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status}`);
    // PNG preserva a transparência na moldura (o Cloudinary converte SVG/WebP/JPG pela extensão)
    eventDraft.logoUrl = data.secure_url.replace(/\.(svg|webp|jpe?g)$/i, '.png');
    renderLogoBox();
    previewEvent();
    toast('Logo enviado! Clique em "Salvar identidade do evento" para aplicar.');
  });
}

async function saveEvent(e) {
  e.preventDefault();
  readEventForm();
  const old = S.config.event;
  const newTag = eventDraft.tag && eventDraft.tag !== old.tag;
  if (newTag) {
    const r = await confirmDialog({
      title:   'Começar um novo evento?',
      message: `O código muda de "${old.tag}" para "${eventDraft.tag}". A galeria e o painel vão mostrar só as fotos do novo código. As fotos atuais continuam guardadas.`,
      okText:  'Trocar código',
    });
    if (!r) return;
  }
  if (await saveConfig({ event: { ...eventDraft } })) {
    fillEventForm();
    toast('Identidade do evento salva! O app atualiza em até 1 minuto.');
    if (newTag) loadAll(); // outro evento: recarrega as fotos
  }
}

/* ── Aba Molduras ── */
let frameDraft = null;
let frameEditingId = null;

function renderFrames() {
  const frames = S.config.frames;
  $('framesGrid').replaceChildren(...frames.map((f, i) => {
    const thumb = h('canvas', { class: 'frame-thumb', 'aria-label': `Prévia da moldura ${f.name}` });
    renderFrameThumb(thumb, f);
    return h('div', { class: 'frame-card' + (f.enabled ? '' : ' is-off') },
      thumb,
      h('div', { class: 'album-body' },
        h('div', { class: 'badges', style: 'margin-bottom:6px' },
          !f.enabled && h('span', { class: 'badge hidden', text: 'Desativada' }),
          h('span', { class: 'badge album', text: FRAME_TEMPLATES.find((t) => t.id === f.base)?.label || f.base })),
        h('h4', { text: f.name }),
        h('p', { text: [f.title || 'Nome do evento', `selo "${f.badgeText}"`].join(' · ') })),
      h('div', { class: 'album-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Editar', onclick: () => openFrameEditor(f.id) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: f.enabled ? 'Desativar' : 'Ativar', onclick: () => updateFrames(frames.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x))) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: '↑', title: 'Mover para cima', disabled: i === 0, onclick: () => moveFrame(i, -1) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: '↓', title: 'Mover para baixo', disabled: i === frames.length - 1, onclick: () => moveFrame(i, 1) }),
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Duplicar', onclick: () => duplicateFrame(f) }),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Excluir', disabled: frames.length === 1, onclick: () => deleteFrame(f) })));
  }));
}

async function renderFrameThumb(target, frame) {
  try {
    const canvas = await renderFrame(await samplePhoto(), { template: frame.base, badge: true, hashtags: S.config.hashtags, theme: frameTheme(frame) });
    paintPreview(target, canvas);
  } catch (_) { /* a prévia é opcional */ }
}

const updateFrames = (frames) => saveConfig({ frames });

function moveFrame(index, dir) {
  const frames = S.config.frames.slice();
  const [f] = frames.splice(index, 1);
  frames.splice(index + dir, 0, f);
  updateFrames(frames);
}

function frameId(name) {
  return (norm(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'moldura') + '_' + Math.random().toString(36).slice(2, 6);
}

async function duplicateFrame(f) {
  if (await updateFrames([...S.config.frames, { ...f, id: frameId(f.name), name: `${f.name} (cópia)`.slice(0, 40) }])) toast('Moldura duplicada.');
}

async function deleteFrame(f) {
  const r = await confirmDialog({ title: `Excluir a moldura "${f.name}"?`, message: 'Os participantes deixam de ver esta opção. As fotos não são afetadas.', okText: 'Excluir', danger: true });
  if (r && await updateFrames(S.config.frames.filter((x) => x.id !== f.id))) toast('Moldura excluída.');
}

function openFrameEditor(id) {
  frameEditingId = id;
  const base = id ? S.config.frames.find((f) => f.id === id)
                  : { name: 'Nova moldura', base: 'classica', primary: '', accent: '', title: '', subtitle: '', badgeText: 'EU FUI!', enabled: true };
  frameDraft = { ...base };
  $('frTitleH').textContent = id ? 'Editar moldura' : 'Nova moldura';
  $('frName').value      = frameDraft.name;
  $('frTitle').value     = frameDraft.title;
  $('frSubtitle').value  = frameDraft.subtitle;
  $('frBadge').value     = frameDraft.badgeText;
  $('frEnabled').checked = frameDraft.enabled;
  $('frUseEvent').checked = !frameDraft.primary && !frameDraft.accent;
  syncFrameColors();
  renderFrameBases();
  openModal('frameModal');
  previewFrame();
}

function renderFrameBases() {
  renderChips($('frBases'), FRAME_TEMPLATES, frameDraft.base, (id) => { frameDraft.base = id; renderFrameBases(); previewFrame(); });
}

/* Com "usar as cores do evento", os seletores mostram as cores do evento e ficam travados */
function syncFrameColors() {
  const useEvent = $('frUseEvent').checked;
  $('frPrimary').value = (useEvent ? S.config.event.primary : frameDraft.primary || S.config.event.primary).toLowerCase();
  $('frAccent').value  = (useEvent ? S.config.event.accent : frameDraft.accent || S.config.event.accent).toLowerCase();
  $('frPrimary').disabled = $('frAccent').disabled = useEvent;
}

function readFrameForm() {
  const useEvent = $('frUseEvent').checked;
  Object.assign(frameDraft, {
    name:      $('frName').value.trim(),
    title:     $('frTitle').value.trim(),
    subtitle:  $('frSubtitle').value.trim(),
    badgeText: $('frBadge').value.trim() || 'EU FUI!',
    enabled:   $('frEnabled').checked,
    primary:   useEvent ? '' : $('frPrimary').value,
    accent:    useEvent ? '' : $('frAccent').value,
  });
}

let framePreviewTimer;
function previewFrame() {
  clearTimeout(framePreviewTimer);
  framePreviewTimer = setTimeout(async () => {
    const canvas = await renderFrame(await samplePhoto(), { template: frameDraft.base, badge: true, hashtags: S.config.hashtags, theme: frameTheme(frameDraft) });
    paintPreview($('frPreview'), canvas);
  }, 200);
}

async function saveFrame(e) {
  e.preventDefault();
  readFrameForm();
  if (!frameDraft.name) { toast('Dê um nome para a moldura.', true); return; }
  const frames = frameEditingId
    ? S.config.frames.map((f) => (f.id === frameEditingId ? { ...frameDraft, id: f.id } : f))
    : [...S.config.frames, { ...frameDraft, id: frameId(frameDraft.name) }];
  if (await updateFrames(frames)) {
    closeModal($('frameModal'));
    toast('Moldura salva! Os participantes veem em até 1 minuto.');
  }
}

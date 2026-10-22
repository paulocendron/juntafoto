/* ============================================================
   JuntaFoto · molduras do evento (desenhadas no navegador, a foto original não muda)
   Usado na galeria (ver foto) e no envio (prévia).
   ============================================================ */
const FRAME_COLORS = {
  blue:     '#004098',
  blueDark: '#002a66',
  orange:   '#E8490F',
  graphite: '#221F1F',
  gray:     '#5B5754',
  paper:    '#fbfaf7',
  white:    '#ffffff',
};

const FRAME_TEMPLATES = [
  { id: 'classica', label: 'Clássica', width: 1080, height: 1350 },
  { id: 'polaroid', label: 'Polaroid', width: 1080, height: 1350 },
  { id: 'stories',  label: 'Stories',  width: 1080, height: 1920 },
];

const FRAME_FONT = "'Poppins', 'Segoe UI', Arial, sans-serif";
const DEFAULT_HASHTAGS = '#ConexaoProfissional2026 #SENAIFraiburgo';

/* Ícone do evento (mesmo desenho do logo oficial, viewBox 200×200) */
const ICON_ARC = new Path2D('M 87.85 168.94 A 70 70 0 1 1 165.78 123.94');

/* ── Carregamento ── */
let framesFontReady = null;
function loadFrameFonts() {
  if (!framesFontReady) {
    framesFontReady = Promise.all(['800 60px Poppins', '700 40px Poppins', '500 30px Poppins']
      .map((f) => document.fonts?.load(f).catch(() => null))).catch(() => null);
  }
  return framesFontReady;
}

/* Imagem do Cloudinary precisa de crossOrigin para o canvas poder exportar o resultado */
function loadFrameImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a foto para a moldura.'));
    img.src = src;
  });
}

/* ── Desenho ── */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* Preenche a área recortando a foto no centro (como object-fit: cover) */
function drawPhotoCover(ctx, img, x, y, w, h, radius = 0) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale, sh = h / scale;
  const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function drawIcon(ctx, x, y, size, { arc = FRAME_COLORS.blue, dot = FRAME_COLORS.graphite, accent = FRAME_COLORS.orange } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 200, size / 200);
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.strokeStyle = arc;
  ctx.stroke(ICON_ARC);
  ctx.fillStyle = dot;
  ctx.beginPath(); ctx.arc(135, 160.62, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(100, 30, 16, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* "CONEXÃO / PROFISSIONAL" + pílula "2026". Retorna a largura ocupada. */
function drawWordmark(ctx, x, y, size, { line1, line2, align = 'left' }) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 ${size}px ${FRAME_FONT}`;
  const w1 = ctx.measureText('CONEXÃO').width;
  const w2 = ctx.measureText('PROFISSIONAL').width;
  const pillW = size * 1.45, pillH = size * 0.62, gap = size * 0.25;
  const total = Math.max(w1, w2 + gap + pillW);
  const left = align === 'center' ? x - total / 2 : x;

  ctx.fillStyle = line1;
  ctx.fillText('CONEXÃO', left, y);
  ctx.fillStyle = line2;
  ctx.fillText('PROFISSIONAL', left, y + size * 1.05);

  const px = left + w2 + gap, py = y + size * 1.05 - size * 0.62;
  ctx.fillStyle = FRAME_COLORS.orange;
  roundRectPath(ctx, px, py, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = FRAME_COLORS.white;
  ctx.font = `800 ${Math.round(size * 0.4)}px ${FRAME_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('2026', px + pillW / 2, py + pillH * 0.7);
  ctx.restore();
  return total;
}

/* Texto que diminui a fonte até caber na largura */
function fitText(ctx, text, x, y, maxWidth, size, { weight = 600, color, align = 'center', min = 18 } = {}) {
  if (!text) return;
  let s = size;
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = color;
  do {
    ctx.font = `${weight} ${s}px ${FRAME_FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 2;
  } while (s > min);
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* Selo "EU FUI!" — carimbo laranja levemente inclinado */
function drawBadge(ctx, cx, cy, r, angle = -0.2) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = r * 0.18;
  ctx.shadowOffsetY = r * 0.06;
  ctx.fillStyle = FRAME_COLORS.orange;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = r * 0.035;
  ctx.setLineDash([r * 0.07, r * 0.05]);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = FRAME_COLORS.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(r * 0.5)}px ${FRAME_FONT}`;
  ctx.fillText('EU FUI!', 0, -r * 0.08, r * 1.5);
  ctx.font = `700 ${Math.round(r * 0.14)}px ${FRAME_FONT}`;
  ctx.fillText('CONEXÃO PROFISSIONAL', 0, r * 0.32, r * 1.25);
  ctx.font = `800 ${Math.round(r * 0.17)}px ${FRAME_FONT}`;
  ctx.fillText('2026', 0, r * 0.56);
  ctx.restore();
}

function formatFrameDate(date) {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* ── Modelos ── */
const FRAME_RENDERERS = {
  classica(ctx, img, { badge, hashtags }) {
    const W = 1080, H = 1350, M = 44;
    ctx.fillStyle = FRAME_COLORS.blue;
    ctx.fillRect(0, 0, W, H);
    // Detalhe laranja no topo
    ctx.fillStyle = FRAME_COLORS.orange;
    ctx.fillRect(0, 0, W, 10);

    const ph = 1040;
    drawPhotoCover(ctx, img, M, M, W - M * 2, ph, 28);

    const bandY = M + ph;
    drawIcon(ctx, 64, bandY + 40, 150, { arc: FRAME_COLORS.white, dot: 'rgba(255,255,255,.4)' });
    drawWordmark(ctx, 240, bandY + 104, 62, { line1: FRAME_COLORS.white, line2: 'rgba(255,255,255,.82)' });
    fitText(ctx, hashtags, W / 2, H - 34, W - 120, 34, { weight: 700, color: FRAME_COLORS.orange });

    if (badge) drawBadge(ctx, W - M - 120, M + 130, 112);
  },

  polaroid(ctx, img, { badge, hashtags, date }) {
    const W = 1080, H = 1350, M = 64;
    ctx.fillStyle = FRAME_COLORS.paper;
    ctx.fillRect(0, 0, W, H);

    const pw = W - M * 2;
    drawPhotoCover(ctx, img, M, M, pw, pw, 6);
    // Sombra interna sutil, como foto revelada
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(M, M, pw, pw);

    const baseY = M + pw;
    drawIcon(ctx, W / 2 - 300, baseY + 52, 96);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = FRAME_COLORS.graphite;
    ctx.font = `800 46px ${FRAME_FONT}`;
    ctx.fillText('Conexão Profissional', W / 2 - 186, baseY + 104);
    ctx.fillStyle = FRAME_COLORS.gray;
    ctx.font = `500 28px ${FRAME_FONT}`;
    ctx.fillText(`${formatFrameDate(date)} · SENAI Fraiburgo`, W / 2 - 186, baseY + 146);
    ctx.restore();
    fitText(ctx, hashtags, W / 2, baseY + 222, W - 140, 32, { weight: 700, color: FRAME_COLORS.blue });

    if (badge) drawBadge(ctx, W - M - 90, baseY - 70, 104, 0.18);
  },

  stories(ctx, img, { badge, hashtags }) {
    const W = 1080, H = 1920, M = 60;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, FRAME_COLORS.blue);
    bg.addColorStop(1, FRAME_COLORS.blueDark);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Topo: ícone + logo centralizados
    drawIcon(ctx, 150, 120, 170, { arc: FRAME_COLORS.white, dot: 'rgba(255,255,255,.4)' });
    drawWordmark(ctx, 350, 205, 70, { line1: FRAME_COLORS.white, line2: 'rgba(255,255,255,.82)' });

    const py = 360, ph = 1280;
    drawPhotoCover(ctx, img, M, py, W - M * 2, ph, 36);

    fitText(ctx, hashtags, W / 2, py + ph + 110, W - 120, 42, { weight: 700, color: FRAME_COLORS.white });
    fitText(ctx, 'Finanças, Carreira e Mercado na Prática · SENAI Fraiburgo', W / 2, py + ph + 170, W - 140, 28, { weight: 500, color: 'rgba(255,255,255,.7)' });

    if (badge) drawBadge(ctx, W - M - 110, py + 120, 120);
  },
};

/**
 * Desenha a foto com a moldura escolhida.
 * @param {HTMLImageElement} img  foto já carregada (com crossOrigin, se vier do Cloudinary)
 * @param {{template?: string, badge?: boolean, hashtags?: string, date?: string}} options
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderFrame(img, { template = 'classica', badge = true, hashtags = DEFAULT_HASHTAGS, date } = {}) {
  await loadFrameFonts();
  const tpl = FRAME_TEMPLATES.find((t) => t.id === template) || FRAME_TEMPLATES[0];
  const canvas = document.createElement('canvas');
  canvas.width  = tpl.width;
  canvas.height = tpl.height;
  const ctx = canvas.getContext('2d');
  FRAME_RENDERERS[tpl.id](ctx, img, { badge, hashtags, date });
  return canvas;
}

function canvasToJpeg(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), 'image/jpeg', quality);
  });
}

/* Compartilha (celular abre a lista de apps, com Instagram) ou baixa, se o navegador não suportar */
async function shareOrDownloadFramed(canvas, { caption = '', filename = 'conexao-profissional-2026.jpg' } = {}) {
  const blob = await canvasToJpeg(canvas);
  const file = new File([blob], filename, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: caption });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

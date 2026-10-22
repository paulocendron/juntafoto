/* ============================================================
   JuntaFoto · molduras do evento (desenhadas no navegador, a foto original não muda)
   Usado na galeria (ver foto), no envio (prévia) e no painel (colagem e molduras).
   Cores, nome e logo vêm do "tema" (ver buildFrameTheme em evento.js).
   ============================================================ */
const FRAME_COLORS = {
  gray:  '#5B5754',
  paper: '#fbfaf7',
  white: '#ffffff',
};

/* Estilos-base: as molduras criadas no painel escolhem um destes e trocam cores/textos */
const FRAME_TEMPLATES = [
  { id: 'classica', label: 'Clássica', width: 1080, height: 1350 },
  { id: 'polaroid', label: 'Polaroid', width: 1080, height: 1350 },
  { id: 'stories',  label: 'Stories',  width: 1080, height: 1920 },
];

const FRAME_FONT = "'Poppins', 'Segoe UI', Arial, sans-serif";
const DEFAULT_HASHTAGS = '#ConexaoProfissional2026 #SENAIFraiburgo';

/* Ícone padrão do JuntaFoto (viewBox 200×200) — usado quando o evento não tem logo próprio */
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
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem para a moldura.'));
    img.src = src;
  });
}

const logoCache = new Map();
function loadLogo(url) {
  if (!url) return Promise.resolve(null);
  if (!logoCache.has(url)) logoCache.set(url, loadFrameImage(url).catch(() => null)); // sem logo, usa o ícone
  return logoCache.get(url);
}

/* Cores derivadas do tema */
function themeColors(t) {
  return {
    primary:     t.primary,
    primaryDark: shadeColor(t.primary, -0.35),
    accent:      t.accent,
    dark:        t.dark,
  };
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

/* Desenha a imagem inteira dentro da caixa (como object-fit: contain) */
function drawContain(ctx, img, x, y, w, h, align = 'left') {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  const dx = align === 'center' ? x + (w - dw) / 2 : x;
  ctx.drawImage(img, dx, y + (h - dh) / 2, dw, dh);
}

function drawIcon(ctx, x, y, size, { arc, dot, accent }) {
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

/* Nome do evento em duas linhas + pílula do ano. Retorna a largura ocupada. */
function drawWordmark(ctx, x, y, size, { t, color1, color2, align = 'left', maxWidth = Infinity }) {
  const { line1, line2 } = eventLines(t.name);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  // Diminui a fonte se o nome não couber
  let s = size, w1, w2, pillW, gap, total;
  do {
    ctx.font = `800 ${s}px ${FRAME_FONT}`;
    w1 = ctx.measureText(line1).width;
    w2 = ctx.measureText(line2 || '').width;
    pillW = t.year ? s * 1.45 : 0;
    gap = t.year ? s * 0.25 : 0;
    total = line2 ? Math.max(w1, w2 + gap + pillW) : w1 + gap + pillW;
    if (total <= maxWidth) break;
    s -= 2;
  } while (s > 18);
  const pillH = s * 0.62;
  const left = align === 'center' ? x - total / 2 : x;

  ctx.fillStyle = color1;
  ctx.fillText(line1, left, y);
  const lastY = line2 ? y + s * 1.05 : y;
  const lastW = line2 ? w2 : w1;
  if (line2) { ctx.fillStyle = color2; ctx.fillText(line2, left, lastY); }

  if (t.year) {
    const px = left + lastW + gap, py = lastY - s * 0.62;
    ctx.fillStyle = t.accent;
    roundRectPath(ctx, px, py, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = FRAME_COLORS.white;
    ctx.font = `800 ${Math.round(s * 0.4)}px ${FRAME_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(t.year, px + pillW / 2, py + pillH * 0.7, pillW * 0.9);
  }
  ctx.restore();
  return total;
}

/* Marca do evento numa caixa: logo próprio (se houver) ou ícone + nome */
function drawBrand(ctx, t, logo, box, { light = true, align = 'left' } = {}) {
  if (logo) { drawContain(ctx, logo, box.x, box.y, box.w, box.h, align); return; }
  const c = themeColors(t);
  const iconColors = light
    ? { arc: FRAME_COLORS.white, dot: 'rgba(255,255,255,.4)', accent: c.accent }
    : { arc: c.primary, dot: c.dark, accent: c.accent };
  const size = Math.round(box.h * 0.41);
  const textX = box.x + box.h + 26;
  if (align === 'center') {
    // Mede para centralizar ícone + texto juntos
    const meas = document.createElement('canvas').getContext('2d');
    const tw = drawWordmark(meas, 0, 0, size, { t, color1: '#000', color2: '#000', maxWidth: box.w - box.h - 26 });
    const startX = box.x + (box.w - (box.h + 26 + tw)) / 2;
    drawIcon(ctx, startX, box.y, box.h, iconColors);
    drawWordmark(ctx, startX + box.h + 26, box.y + box.h * 0.5, size, wordmarkColors(t, light, box.w - box.h - 26));
    return;
  }
  drawIcon(ctx, box.x, box.y, box.h, iconColors);
  drawWordmark(ctx, textX, box.y + box.h * 0.5, size, wordmarkColors(t, light, box.x + box.w - textX));
}

function wordmarkColors(t, light, maxWidth) {
  return light
    ? { t, color1: FRAME_COLORS.white, color2: 'rgba(255,255,255,.82)', maxWidth }
    : { t, color1: t.primary, color2: t.dark, maxWidth };
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

/* Selo (padrão "EU FUI!") — carimbo levemente inclinado na cor de destaque */
function drawBadge(ctx, cx, cy, r, angle = -0.2, t = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = r * 0.18;
  ctx.shadowOffsetY = r * 0.06;
  ctx.fillStyle = t.accent || '#E8490F';
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
  ctx.fillText(t.badgeText || 'EU FUI!', 0, -r * 0.08, r * 1.5);
  ctx.font = `700 ${Math.round(r * 0.14)}px ${FRAME_FONT}`;
  ctx.fillText(String(t.name || '').toUpperCase(), 0, r * 0.32, r * 1.25);
  if (t.year) {
    ctx.font = `800 ${Math.round(r * 0.17)}px ${FRAME_FONT}`;
    ctx.fillText(t.year, 0, r * 0.56);
  }
  ctx.restore();
}

function formatFrameDate(date) {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/* ── Estilos-base ── */
const FRAME_RENDERERS = {
  classica(ctx, img, { badge, hashtags, t, logo }) {
    const W = 1080, H = 1350, M = 44;
    const c = themeColors(t);
    ctx.fillStyle = c.primary;
    ctx.fillRect(0, 0, W, H);
    // Detalhe na cor de destaque no topo
    ctx.fillStyle = c.accent;
    ctx.fillRect(0, 0, W, 10);

    const ph = 1040;
    drawPhotoCover(ctx, img, M, M, W - M * 2, ph, 28);

    const bandY = M + ph;
    drawBrand(ctx, t, logo, { x: 64, y: bandY + 40, w: W - 128, h: 150 });
    fitText(ctx, t.subtitle || hashtags, W / 2, H - 34, W - 120, 34, { weight: 700, color: c.accent });

    if (badge) drawBadge(ctx, W - M - 120, M + 130, 112, -0.2, t);
  },

  polaroid(ctx, img, { badge, hashtags, date, t, logo }) {
    const W = 1080, H = 1350, M = 64;
    const c = themeColors(t);
    ctx.fillStyle = FRAME_COLORS.paper;
    ctx.fillRect(0, 0, W, H);

    const pw = W - M * 2;
    drawPhotoCover(ctx, img, M, M, pw, pw, 6);
    // Contorno sutil, como foto revelada
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(M, M, pw, pw);

    const baseY = M + pw;
    if (logo) {
      drawContain(ctx, logo, M, baseY + 36, pw, 110, 'center');
    } else {
      drawIcon(ctx, W / 2 - 300, baseY + 52, 96, { arc: c.primary, dot: c.dark, accent: c.accent });
      fitText(ctx, t.name, W / 2 - 186, baseY + 104, 680, 46, { weight: 800, color: c.dark, align: 'left' });
    }
    const line = t.subtitle || [formatFrameDate(date), t.place].filter(Boolean).join(' · ');
    fitText(ctx, line, logo ? W / 2 : W / 2 - 186, baseY + (logo ? 182 : 146), logo ? pw : 680, 28, { weight: 500, color: FRAME_COLORS.gray, align: logo ? 'center' : 'left' });
    fitText(ctx, hashtags, W / 2, baseY + 222, W - 140, 32, { weight: 700, color: c.primary });

    if (badge) drawBadge(ctx, W - M - 90, baseY - 70, 104, 0.18, t);
  },

  stories(ctx, img, { badge, hashtags, t, logo }) {
    const W = 1080, H = 1920, M = 60;
    const c = themeColors(t);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, c.primary);
    bg.addColorStop(1, c.primaryDark);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Topo: marca do evento centralizada
    drawBrand(ctx, t, logo, { x: M, y: 110, w: W - M * 2, h: 170 }, { align: 'center' });

    const py = 360, ph = 1280;
    drawPhotoCover(ctx, img, M, py, W - M * 2, ph, 36);

    fitText(ctx, hashtags, W / 2, py + ph + 110, W - 120, 42, { weight: 700, color: FRAME_COLORS.white });
    const line = t.subtitle || [t.tagline, t.place].filter(Boolean).join(' · ');
    fitText(ctx, line, W / 2, py + ph + 170, W - 140, 28, { weight: 500, color: 'rgba(255,255,255,.7)' });

    if (badge) drawBadge(ctx, W - M - 110, py + 120, 120, -0.2, t);
  },
};

/**
 * Desenha a foto com a moldura.
 * @param {HTMLImageElement} img  foto já carregada (com crossOrigin, se vier do Cloudinary)
 * @param {{template?: string, badge?: boolean, hashtags?: string, date?: string, theme?: object}} options
 *        template = estilo-base (classica|polaroid|stories); theme = buildFrameTheme(evento, moldura)
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderFrame(img, { template = 'classica', badge = true, hashtags = DEFAULT_HASHTAGS, date, theme } = {}) {
  await loadFrameFonts();
  const t    = theme || buildFrameTheme();
  const logo = await loadLogo(t.logoUrl);
  const tpl  = FRAME_TEMPLATES.find((x) => x.id === template) || FRAME_TEMPLATES[0];
  const canvas = document.createElement('canvas');
  canvas.width  = tpl.width;
  canvas.height = tpl.height;
  const ctx = canvas.getContext('2d');
  FRAME_RENDERERS[tpl.id](ctx, img, { badge, hashtags, date, t, logo });
  return canvas;
}

function canvasToJpeg(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), 'image/jpeg', quality);
  });
}

/* Compartilha (celular abre a lista de apps, com Instagram) ou baixa, se o navegador não suportar */
async function shareOrDownloadFramed(canvas, { caption = '', filename = 'foto-com-moldura.jpg' } = {}) {
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

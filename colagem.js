/* ============================================================
   JuntaFoto · colagem de várias fotos numa moldura só (painel admin)
   Usa os desenhos de moldura.js (logo, selo, textos).
   ============================================================ */
const COLLAGE_FORMATS = [
  { id: 'feed',     label: 'Feed (4:5)',     width: 1080, height: 1350, top: 190, bottom: 180 },
  { id: 'quadrado', label: 'Quadrado (1:1)', width: 1080, height: 1080, top: 160, bottom: 150 },
  { id: 'stories',  label: 'Stories (9:16)', width: 1080, height: 1920, top: 300, bottom: 280 },
];

const COLLAGE_LAYOUTS = [
  { id: 'grade',    label: 'Grade' },
  { id: 'destaque', label: 'Destaque' },
];

const COLLAGE_MAX  = 9;
const COLLAGE_GAP  = 12;
const COLLAGE_SIDE = 40;

/* Divide uma área em células: escolhe o nº de colunas que deixa as fotos mais perto do formato retrato.
   A última linha, se tiver menos fotos, se estica para ocupar a largura toda. */
function gridCells(n, x, y, w, h, gap = COLLAGE_GAP) {
  if (n <= 0) return [];
  let best = null;
  for (let cols = 1; cols <= Math.min(3, n); cols++) {
    const rows   = Math.ceil(n / cols);
    const aspect = ((w - gap * (cols - 1)) / cols) / ((h - gap * (rows - 1)) / rows);
    const score  = Math.abs(Math.log(aspect / 0.85));
    if (!best || score < best.score) best = { cols, rows, score };
  }
  const { cols, rows } = best;
  const ch = (h - gap * (rows - 1)) / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const cw = (w - gap * (inRow - 1)) / inRow;
    for (let c = 0; c < inRow; c++) cells.push({ x: x + c * (cw + gap), y: y + r * (ch + gap), w: cw, h: ch });
  }
  return cells;
}

/* "Destaque": a primeira foto grande em cima, as outras em grade embaixo */
function featureCells(n, x, y, w, h, gap = COLLAGE_GAP) {
  if (n < 3) return gridCells(n, x, y, w, h, gap);
  const bigH = Math.round((h - gap) * 0.6);
  return [{ x, y, w, h: bigH }, ...gridCells(n - 1, x, y + bigH + gap, w, h - bigH - gap, gap)];
}

/**
 * Desenha a colagem.
 * @param {HTMLImageElement[]} images fotos já carregadas (com crossOrigin)
 * @param {{format?: string, layout?: string, title?: string, subtitle?: string, badge?: boolean, hashtags?: string}} o
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderCollage(images, o = {}) {
  await loadFrameFonts();
  const t    = o.theme || buildFrameTheme();
  const c    = themeColors(t);
  const logo = await loadLogo(t.logoUrl);
  const fmt = COLLAGE_FORMATS.find((f) => f.id === o.format) || COLLAGE_FORMATS[0];
  const { width: W, height: H, top, bottom } = fmt;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Fundo na cor principal do evento, com faixa na cor de destaque
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, c.primary);
  bg.addColorStop(1, c.primaryDark);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = c.accent;
  ctx.fillRect(0, 0, W, 10);

  // Topo: marca do evento
  drawBrand(ctx, t, logo, { x: 70, y: top * 0.2, w: W - 140, h: top * 0.6 });

  // Fotos
  const area = { x: COLLAGE_SIDE, y: top, w: W - COLLAGE_SIDE * 2, h: H - top - bottom };
  const list = images.slice(0, COLLAGE_MAX);
  const cells = (o.layout === 'destaque' ? featureCells : gridCells)(list.length, area.x, area.y, area.w, area.h);
  cells.forEach((c, i) => drawPhotoCover(ctx, list[i], c.x, c.y, c.w, c.h, 18));

  // Base: título, subtítulo e hashtags
  const by = H - bottom;
  fitText(ctx, o.title || [t.name, t.year].filter(Boolean).join(' '), W / 2, by + bottom * 0.36, W - 120, Math.round(bottom * 0.25), { weight: 800, color: FRAME_COLORS.white });
  fitText(ctx, o.subtitle || '', W / 2, by + bottom * 0.6, W - 140, Math.round(bottom * 0.15), { weight: 500, color: 'rgba(255,255,255,.75)' });
  fitText(ctx, o.hashtags ?? DEFAULT_HASHTAGS, W / 2, by + bottom * 0.85, W - 120, Math.round(bottom * 0.17), { weight: 700, color: c.accent });

  if (o.badge) {
    const r = Math.round(Math.min(W, H) * 0.1);
    drawBadge(ctx, W - COLLAGE_SIDE - r * 0.75, top + r * 0.75, r, -0.2, t);
  }
  return canvas;
}

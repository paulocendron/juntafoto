/* ============================================================
   JuntaFoto · identidade do evento (nome, cores, logo) — usado pelo app e pelo painel
   Os valores vêm de /api/config (editados no painel, aba "Evento").
   ============================================================ */
const DEFAULT_EVENT = {
  name:    'Conexão Profissional',
  year:    '2026',
  tagline: 'Finanças, Carreira e Mercado na Prática',
  place:   'SENAI Fraiburgo',
  primary: '#004098',
  accent:  '#E8490F',
  dark:    '#221F1F',
  logoUrl: '',
  tag:     'conexao2026',
};

const DEFAULT_FRAMES = [
  { id: 'classica', name: 'Clássica', base: 'classica', primary: '', accent: '', title: '', subtitle: '', badgeText: 'EU FUI!', enabled: true },
  { id: 'polaroid', name: 'Polaroid', base: 'polaroid', primary: '', accent: '', title: '', subtitle: '', badgeText: 'EU FUI!', enabled: true },
  { id: 'stories',  name: 'Stories',  base: 'stories',  primary: '', accent: '', title: '', subtitle: '', badgeText: 'EU FUI!', enabled: true },
];

/* Escurece (amt < 0) ou clareia (amt > 0) uma cor #rrggbb */
function shadeColor(hex, amt) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const mix = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* "Conexão Profissional" → linha 1 "CONEXÃO", linha 2 "PROFISSIONAL" (nomes longos: divide ao meio) */
function eventLines(name) {
  const words = String(name || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { line1: words[0] || '', line2: '' };
  if (words.length === 2) return { line1: words[0], line2: words[1] };
  let best = 1, diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < diff) { diff = d; best = i; }
  }
  return { line1: words.slice(0, best).join(' '), line2: words.slice(best).join(' ') };
}

function eventData(ev) {
  const e = { ...DEFAULT_EVENT, ...(ev || {}) };
  return { ...e, fullName: [e.name, e.year].filter(Boolean).join(' '), ...eventLines(e.name) };
}

/* Tema usado pelas molduras/colagem: cores e textos do evento, com as trocas da moldura personalizada */
function buildFrameTheme(ev, frame = {}) {
  const e = eventData(ev);
  return {
    name:      frame.title || e.name,
    year:      e.year,
    tagline:   e.tagline,
    place:     e.place,
    subtitle:  frame.subtitle || '',
    primary:   frame.primary || e.primary,
    accent:    frame.accent || e.accent,
    dark:      e.dark,
    logoUrl:   e.logoUrl,
    badgeText: frame.badgeText || 'EU FUI!',
  };
}

/* Aplica cores e textos na página (elementos com data-ev="name|year|line1|line2|tagline|place|fullName|sub") */
function applyEventTheme(ev) {
  const e = eventData(ev);
  const root = document.documentElement.style;
  root.setProperty('--blue', e.primary);
  root.setProperty('--blue-dark', shadeColor(e.primary, -0.3));
  root.setProperty('--orange', e.accent);
  root.setProperty('--orange-dk', shadeColor(e.accent, -0.15));
  root.setProperty('--graphite', e.dark);

  const texts = { ...e, sub: [e.place, e.tagline].filter(Boolean).join(' · ') };
  document.querySelectorAll('[data-ev]').forEach((el) => {
    const v = texts[el.dataset.ev] ?? '';
    el.textContent = v;
    el.hidden = !v;
  });
  // Logo próprio do evento substitui o ícone padrão
  document.querySelectorAll('[data-ev-logo]').forEach((img) => {
    img.hidden = !e.logoUrl;
    if (e.logoUrl && img.src !== e.logoUrl) img.src = e.logoUrl;
  });
  document.querySelectorAll('[data-ev-icon]').forEach((el) => { el.hidden = !!e.logoUrl; });

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', e.primary);
  if (document.body.dataset.titlePrefix !== undefined) document.title = `${document.body.dataset.titlePrefix}${e.fullName}`;
}

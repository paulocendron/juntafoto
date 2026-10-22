/* ============================================================
   JuntaFoto · tema claro / escuro / automático (app e painel admin)
   A escolha fica salva neste aparelho (localStorage "jf_theme").
   O <head> de cada página aplica o tema salvo antes de desenhar, para não "piscar".
   ============================================================ */
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_INFO = {
  auto:  { label: 'Automático (segue o aparelho)',
           icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>' },
  light: { label: 'Claro',
           icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>' },
  dark:  { label: 'Escuro',
           icon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>' },
};

let themeMode = 'auto';

function getTheme() {
  try {
    const saved = localStorage.getItem('jf_theme');
    return THEME_ORDER.includes(saved) ? saved : 'auto';
  } catch (_) { return 'auto'; }
}

function applyTheme(mode) {
  themeMode = mode;
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  const info = THEME_INFO[mode];
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${info.icon}</svg>`;
    b.title = `Tema: ${info.label} — toque para trocar`;
    b.setAttribute('aria-label', `Tema: ${info.label}. Toque para trocar.`);
  });
}

/* Liga os botões [data-theme-toggle]; onChange(texto) serve para mostrar um aviso */
function initThemeToggle(onChange) {
  applyTheme(getTheme());
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length];
    try { localStorage.setItem('jf_theme', next); } catch (_) { /* sem armazenamento: vale só nesta visita */ }
    applyTheme(next);
    onChange?.(`Tema: ${THEME_INFO[next].label}`);
  }));
}

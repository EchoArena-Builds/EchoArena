/* ============================================================
   UI-CORE — helpers puros compartilhados entre as páginas.
   Sem estado, sem DOM global, sem Supabase.
   Fonte única de escape, sanitização e mídia.
   ============================================================ */

export const RARIDADES = {
  comum:      { nome: 'Comum',      cor: '#8A93AD' },
  raro:       { nome: 'Raro',       cor: '#4CC7E8' },
  epico:      { nome: 'Épico',      cor: '#A855F7' },
  divino:     { nome: 'Divino',     cor: '#FBBF24' },
  lendario:   { nome: 'Lendário',   cor: '#FBBF24' },
  mitico:     { nome: 'Mítico',     cor: '#FB923C' },
  supremo:    { nome: 'Supremo',    cor: '#F87171' },
  grandioso:  { nome: 'Grandioso',  cor: '#C084FC' },
  celestial:  { nome: 'Celestial',  cor: '#38BDF8' },
  estelar:    { nome: 'Estelar',    cor: '#A78BFA' },
  imortal:    { nome: 'Imortal',    cor: '#FB7185' }
};

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/* Valores vindos do banco entram em style/src filtrados. */
export const cssSafe = v => String(v ?? '').replace(/[^\w\s%.,+-]/g, '');
export const numSafe = (v, padrao) => (Number.isFinite(Number(v)) ? Number(v) : padrao);
export const srcSafe = s => {
  const v = String(s ?? '').trim();
  return /^(https?:\/\/|data:image\/|\.{0,2}\/)/i.test(v) ? v : '';
};

export const isVid = s => /\.(mp4|webm)(\?.*)?$/i.test(s || '');

export const mStyle = m => m
  ? `--fit:${cssSafe(m.fit || 'contain')};--pos:${cssSafe(m.pos || '50% 50%')};` +
    `--scale:${numSafe(m.scale, 1)};--x:${cssSafe(m.x || 0)};--y:${cssSafe(m.y || 0)}`
  : '';

export const mInner = m => {
  const src = srcSafe(m?.src);
  if (!src) return '';
  return isVid(src)
    ? `<video src="${esc(src)}" autoplay muted loop playsinline></video>`
    : `<img src="${esc(src)}" alt="" loading="lazy">`;
};

export const normalizar = s => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

export const rc = r => (RARIDADES[r] || RARIDADES.comum).cor;
export const rn = r => (RARIDADES[r] || RARIDADES.comum).nome;

export function nivelAtual(item) {
  return item?.levels?.find(level => level.slug === item.raridade) || item?.levels?.[0] || null;
}

export function nomeDoNivel(item) {
  return nivelAtual(item)?.nome || rn(item?.raridade);
}

export function corDoItem(item) {
  if (!item) return '#332B63';
  return nivelAtual(item)?.cor || rc(item.raridade);
}

export function pintar(el, m) {
  if (!el) return;
  el.setAttribute('style', mStyle(m));
  el.innerHTML = mInner(m);
  el.classList.toggle('ph', !(m && m.src));
}

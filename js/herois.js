import { supabase } from './supabase.js';

import {
  initSiteShell,
  escapeHtml,
  compactNumber,
  classColor,
  mediaOf,
  mediaStyle,
  mediaInner
} from './site-shell.js';

const shell = await initSiteShell({ activeId: 'herois' });
if (!shell) throw new Error('BLOQUEADO');

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = (id) => document.getElementById(id);

const grid = $('grid');
const search = $('search');
const sort = $('sort');
const countLabel = $('count');
const classFilters = $('class-filters');

const detail = $('hero-detail');
const detailBackdrop = $('hd-backdrop');
const detailClose = $('hd-close');
const detailMedia = $('hd-media');
const detailBody = $('hd-body');

/* =========================================================
   ESTADO
========================================================= */

let heroes = [];
let classes = [];
let activeClass = '';

/* =========================================================
   UTILITÁRIOS
========================================================= */

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/* =========================================================
   FILTRO E ORDENAÇÃO
========================================================= */

function visibleHeroes() {
  const query = normalize(search?.value);

  const rows = heroes.filter(hero => {
    const matchesClass = !activeClass || hero.class_slug === activeClass;

    const matchesQuery = !query ||
      normalize(hero.name).includes(query) ||
      normalize(hero.subtitle).includes(query) ||
      normalize(hero.class_name).includes(query);

    return matchesClass && matchesQuery;
  });

  const mode = sort?.value || 'ordem';

  return rows.sort((first, second) => {
    if (mode === 'nome') {
      return String(first.name || '').localeCompare(String(second.name || ''), 'pt-BR');
    }

    if (mode === 'builds') {
      return Number(second.total_builds || 0) - Number(first.total_builds || 0);
    }

    const orderDiff = Number(first.display_order ?? 0) - Number(second.display_order ?? 0);
    if (orderDiff !== 0) return orderDiff;

    return String(first.name || '').localeCompare(String(second.name || ''), 'pt-BR');
  });
}

/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function renderClassFilters() {
  const buttons = classes.map(item => `
    <b data-class="${escapeHtml(item.slug)}"
       style="--class-color:${escapeHtml(classColor(item))}">
      ${escapeHtml(item.name)}
    </b>
  `).join('');

  classFilters.innerHTML = `<b class="on" data-class="">Todas</b>${buttons}`;
}

function renderGrid() {
  const rows = visibleHeroes();

  countLabel.textContent = rows.length === 1
    ? '1 herói'
    : `${rows.length} heróis`;

  if (!rows.length) {
    grid.innerHTML = '<div class="loading-card">Nenhum herói encontrado.</div>';
    return;
  }

  grid.innerHTML = rows.map(hero => {
    const media = mediaOf(hero, 'card');
    const color = classColor(hero);
    const enabled = hero.enabled !== false;

    return `
      <article class="hc ${enabled ? '' : 'off'}"
               data-slug="${escapeHtml(hero.slug)}"
               style="--class-color:${escapeHtml(color)}">
        <div class="thumb">
          <div class="media ${media ? '' : 'empty'}" style="${mediaStyle(media, 'cover')}">
            ${mediaInner(media, hero.name)}
          </div>
          <div class="fade"></div>
          <div class="cap">
            <div class="n">${escapeHtml(hero.name)}</div>
            <div class="r">${escapeHtml(hero.class_name || 'Sem classe')}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

/* =========================================================
   PAINEL DE DETALHE
========================================================= */

function openDetail(slug) {
  const hero = heroes.find(item => item.slug === slug);
  if (!hero) return;

  const color = classColor(hero);
  const media = mediaOf(hero, 'main');

  detail.style.setProperty('--class-color', color);
  detailMedia.setAttribute('style', mediaStyle(media, 'contain'));
  detailMedia.innerHTML = mediaInner(media, hero.name);
  detailMedia.classList.toggle('empty', !media);

  const enabled = hero.enabled !== false;

  detailBody.innerHTML = `
    <h2>${escapeHtml(hero.name)}</h2>
    <div class="hd-sub">${escapeHtml(hero.subtitle || hero.class_name || '')}</div>

    <div class="hd-badges">
      <span class="hd-badge">${escapeHtml(hero.class_name || 'Sem classe')}</span>
      ${enabled ? '' : '<span class="hd-badge off">Indisponível</span>'}
    </div>

    <div class="hd-section">
      <h3>Sobre</h3>
      <div class="hd-text">${escapeHtml(
        hero.description || 'Informações em atualização.'
      )}</div>
    </div>

    ${hero.lore ? `
      <div class="hd-section">
        <h3>História</h3>
        <div class="hd-text">${escapeHtml(hero.lore)}</div>
      </div>
    ` : ''}

    <div class="hd-section">
      <h3>Na comunidade</h3>
      <div class="hd-stats">
        <div class="hd-stat">
          <span>Builds</span>
          <strong>${compactNumber(hero.total_builds || 0)}</strong>
        </div>
        <div class="hd-stat">
          <span>Views</span>
          <strong>${compactNumber(hero.total_views || 0)}</strong>
        </div>
        <div class="hd-stat">
          <span>Curtidas</span>
          <strong>${compactNumber(hero.total_likes || 0)}</strong>
        </div>
      </div>
    </div>

    <a class="hd-cta" href="./criar-build.html">Criar build com este herói</a>
  `;

  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');
  detailBackdrop.classList.add('open');
}

function closeDetail() {
  detail.classList.remove('open');
  detail.setAttribute('aria-hidden', 'true');
  detailBackdrop.classList.remove('open');
}

/* =========================================================
   EVENTOS
========================================================= */

grid.addEventListener('click', (event) => {
  const card = event.target.closest('[data-slug]');
  if (card) openDetail(card.dataset.slug);
});

classFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-class]');
  if (!button) return;

  activeClass = button.dataset.class;

  classFilters.querySelectorAll('b').forEach(item => {
    item.classList.toggle('on', item === button);
  });

  renderGrid();
});

let searchTimer = null;

search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderGrid, 200);
});

sort.addEventListener('change', renderGrid);

detailClose.addEventListener('click', closeDetail);
detailBackdrop.addEventListener('click', closeDetail);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDetail();
});

/* =========================================================
   CARREGAMENTO
========================================================= */

async function load() {
  try {
    const [heroesResult, classesResult] = await Promise.all([
      supabase
        .from('v_heroes_complete')
        .select('*')
        .eq('enabled', true),

      supabase
        .from('hero_classes')
        .select('id, name, slug, color')
        .order('name')
    ]);

    if (heroesResult.error) throw heroesResult.error;

    heroes = heroesResult.data ?? [];
    classes = classesResult.data ?? [];

    renderClassFilters();
    renderGrid();
  } catch (error) {
    console.error('Erro ao carregar heróis:', error);
    grid.innerHTML = '<div class="loading-card">Não foi possível carregar os heróis.</div>';
    countLabel.textContent = '—';
  }
}

await load();

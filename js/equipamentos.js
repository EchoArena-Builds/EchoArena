import { supabase } from './supabase.js';

import {
  initSiteShell,
  escapeHtml
} from './site-shell.js';

const shell = await initSiteShell({ activeId: 'equipamentos' });
if (!shell) throw new Error('BLOQUEADO');

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = (id) => document.getElementById(id);

const grid = $('grid');
const search = $('search');
const rarityFilter = $('rarity');
const sort = $('sort');
const countLabel = $('count');
const slotFilters = $('slot-filters');

const detail = $('eq-detail');
const detailBackdrop = $('ed-backdrop');
const detailClose = $('ed-close');
const detailMedia = $('ed-media');
const detailBody = $('ed-body');
const detailName = $('ed-name');
const detailSet = $('ed-set');
const detailSlot = $('ed-slot');

/* =========================================================
   ESTADO
========================================================= */

const BUCKET = 'game-media';

let equipments = [];
let slots = new Map();
let sets = new Map();
let levelsByEquipment = new Map();
let bonusesBySet = new Map();
let rarities = new Map();

let activeSlot = '';
let currentItem = null;
let currentRarity = null;

/* Cores padrão quando a raridade não trouxer a sua. */
const RARITY_FALLBACK = {
  comum: '#8A93AD', raro: '#4CC7E8', epico: '#A855F7', divino: '#FBBF24',
  lendario: '#FBBF24', mitico: '#FB923C', supremo: '#F87171',
  grandioso: '#C084FC', celestial: '#38BDF8', estelar: '#A78BFA', imortal: '#FB7185'
};

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

function publicUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function mediaBlock(path, alt = '') {
  const url = publicUrl(path);

  if (!url) return '<div class="media empty" style="--fit:contain"></div>';

  return `<div class="media" style="--fit:contain">
    <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">
  </div>`;
}

function rarityColor(slug) {
  const stored = rarities.get(slug);
  if (stored?.color) return stored.color;
  return RARITY_FALLBACK[slug] || '#8A93AD';
}

function rarityName(slug) {
  const stored = rarities.get(slug);
  if (stored?.name) return stored.name;
  if (!slug) return 'Comum';
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function rarityOrder(slug) {
  return rarities.get(slug)?.order ?? 999;
}

/* Raridade base do item: o primeiro nível cadastrado. */
function baseRarity(item) {
  const levels = levelsByEquipment.get(item.id) || [];
  return levels[0]?.rarity_slug || String(item.rarity || 'comum').toLowerCase();
}

function formatStatLabel(key) {
  const labels = {
    vision_range: 'Alcance de visão do herói',
    weapon_damage_to_armor_pct: 'Dano da arma à armadura inimiga',
    weapon_damage_to_health_pct: 'Dano da arma à vida inimiga',
    weapon_range_franco: 'Alcance de tiro do Franco',
    special_ability_cooldown_pct: 'Recarga da habilidade especial',
    crate_opening_cooldown_pct: 'Tempo de abertura da caixa'
  };

  return labels[key] || String(key).replaceAll('_', ' ');
}

function formatStatValue(key, value) {
  const number = Number(value);
  const sign = number >= 0 ? '+' : '';

  return String(key).endsWith('_pct')
    ? `${sign}${value}%`
    : `${sign}${value}`;
}

/* =========================================================
   FILTRO E ORDENAÇÃO
========================================================= */

function visibleEquipments() {
  const query = normalize(search?.value);
  const rarity = rarityFilter?.value || '';

  const rows = equipments.filter(item => {
    const slot = slots.get(item.slot_id);

    const matchesSlot = !activeSlot || slot?.slug === activeSlot;

    const matchesRarity = !rarity ||
      (levelsByEquipment.get(item.id) || []).some(l => l.rarity_slug === rarity) ||
      baseRarity(item) === rarity;

    const matchesQuery = !query ||
      normalize(item.name).includes(query) ||
      normalize(item.description).includes(query) ||
      normalize(sets.get(item.set_id)?.name).includes(query);

    return matchesSlot && matchesRarity && matchesQuery;
  });

  const mode = sort?.value || 'ordem';

  return rows.sort((first, second) => {
    if (mode === 'nome') {
      return String(first.name || '').localeCompare(String(second.name || ''), 'pt-BR');
    }

    if (mode === 'raridade') {
      const diff = rarityOrder(baseRarity(second)) - rarityOrder(baseRarity(first));
      if (diff !== 0) return diff;
      return String(first.name || '').localeCompare(String(second.name || ''), 'pt-BR');
    }

    const orderDiff = Number(first.display_order ?? 0) - Number(second.display_order ?? 0);
    if (orderDiff !== 0) return orderDiff;

    return String(first.name || '').localeCompare(String(second.name || ''), 'pt-BR');
  });
}

/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function renderSlotFilters() {
  const list = [...slots.values()]
    .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));

  const buttons = list
    .map(slot => `<b data-slot="${escapeHtml(slot.slug)}">${escapeHtml(slot.name)}</b>`)
    .join('');

  slotFilters.innerHTML = `<b class="on" data-slot="">Todos</b>${buttons}`;
}

function renderRarityOptions() {
  const list = [...rarities.values()]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  rarityFilter.innerHTML = '<option value="">Todas</option>' + list
    .map(item => `<option value="${escapeHtml(item.slug)}">${escapeHtml(item.name)}</option>`)
    .join('');
}

function renderGrid() {
  const rows = visibleEquipments();

  countLabel.textContent = rows.length === 1
    ? '1 equipamento'
    : `${rows.length} equipamentos`;

  if (!rows.length) {
    grid.innerHTML = '<div class="loading-card">Nenhum equipamento encontrado.</div>';
    return;
  }

  grid.innerHTML = rows.map(item => {
    const slug = baseRarity(item);
    const color = rarityColor(slug);
    const slot = slots.get(item.slot_id);
    const set = sets.get(item.set_id);

    return `
      <article class="eq" data-id="${escapeHtml(item.id)}" style="--rc:${escapeHtml(color)}">
        <div class="ic">${mediaBlock(item.image_path || item.image_url, item.name)}</div>

        <div class="tx">
          <b>${escapeHtml(item.name)}</b>
          <span class="rar">${escapeHtml(rarityName(slug))}</span>
          <span class="slot">${escapeHtml(slot?.name || 'Sem slot')}</span>
        </div>

        ${set ? `<span class="set">${escapeHtml(set.name)}</span>` : ''}
      </article>
    `;
  }).join('');
}

/* =========================================================
   PAINEL DE DETALHE
========================================================= */

function renderDetailBody() {
  const item = currentItem;
  if (!item) return;

  const levels = levelsByEquipment.get(item.id) || [];
  const level = levels.find(l => l.rarity_slug === currentRarity) || levels[0] || null;
  const color = rarityColor(currentRarity || baseRarity(item));

  detail.style.setProperty('--rc', color);

  const stats = level?.stats || {};

  const statRows = Object.entries(stats).length
    ? Object.entries(stats).map(([key, value]) => `
        <div class="st-row">
          <span>${escapeHtml(formatStatLabel(key))}</span>
          <strong>${escapeHtml(formatStatValue(key, value))}</strong>
        </div>
      `).join('')
    : '<div class="loading-card">Sem atributos cadastrados neste nível.</div>';

  const set = sets.get(item.set_id);
  const bonuses = set ? (bonusesBySet.get(set.id) || []) : [];
  const maxPieces = bonuses.length
    ? Math.max(...bonuses.map(b => Number(b.required_pieces) || 0))
    : 0;

  detailBody.innerHTML = `
    ${item.description ? `
      <div class="ed-section">
        <h3>Descrição</h3>
        <div class="ed-desc">${escapeHtml(item.description)}</div>
      </div>
    ` : ''}

    ${levels.length ? `
      <div class="ed-section">
        <h3><span>Classificação</span><span>${escapeHtml(rarityName(currentRarity))}</span></h3>
        <div class="rar-picker">
          ${levels.map(l => `
            <button class="rar-btn ${l.rarity_slug === currentRarity ? 'on' : ''}"
                    data-rarity="${escapeHtml(l.rarity_slug)}"
                    style="--rc:${escapeHtml(l.rarity_color || rarityColor(l.rarity_slug))}">
              ${escapeHtml(l.rarity_name || rarityName(l.rarity_slug))}
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="ed-section">
      <h3><span>Atributos</span><span>${Object.keys(stats).length}</span></h3>
      <div class="st-list">${statRows}</div>
    </div>

    ${set ? `
      <div class="ed-section">
        <h3><span>${escapeHtml(set.name)}</span><span>${bonuses.length} bônus</span></h3>

        ${set.description ? `<div class="ed-desc" style="margin-bottom:12px">${escapeHtml(set.description)}</div>` : ''}

        ${maxPieces ? `
          <div class="set-progress">
            <div class="track"><i style="width:0%"></i></div>
            <b>0/${maxPieces}</b>
          </div>
        ` : ''}

        ${bonuses.map(bonus => `
          <div class="set-bonus">
            <div class="pieces">${escapeHtml(bonus.required_pieces)}</div>
            <div>
              <b>${escapeHtml(bonus.title || '')}</b>
              <p>${escapeHtml(bonus.description || '')}</p>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${item.recommendation_text ? `
      <div class="ed-section">
        <div class="reco">
          <b>Indicação</b>
          ${escapeHtml(item.recommendation_text)}
        </div>
      </div>
    ` : ''}
  `;

  detailBody.querySelectorAll('[data-rarity]').forEach(button => {
    button.addEventListener('click', () => {
      currentRarity = button.dataset.rarity;
      renderDetailBody();
    });
  });
}

function openDetail(id) {
  const item = equipments.find(entry => String(entry.id) === String(id));
  if (!item) return;

  currentItem = item;
  currentRarity = baseRarity(item);

  const slot = slots.get(item.slot_id);
  const set = sets.get(item.set_id);

  detailName.textContent = item.name || '—';
  detailSet.textContent = set?.name || 'Equipamento individual';
  detailSlot.textContent = slot?.name || 'Sem slot definido';

  detailMedia.outerHTML = mediaBlock(item.image_path || item.image_url, item.name)
    .replace('class="media', 'id="ed-media" class="media');

  renderDetailBody();

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
  const card = event.target.closest('[data-id]');
  if (card) openDetail(card.dataset.id);
});

slotFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-slot]');
  if (!button) return;

  activeSlot = button.dataset.slot;

  slotFilters.querySelectorAll('b').forEach(item => {
    item.classList.toggle('on', item === button);
  });

  renderGrid();
});

let searchTimer = null;

search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderGrid, 200);
});

rarityFilter.addEventListener('change', renderGrid);
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
    const [
      equipmentsResult,
      slotsResult,
      setsResult,
      levelsResult,
      bonusesResult
    ] = await Promise.all([
      supabase
        .from('equipments')
        .select('id, name, description, image_path, image_url, rarity, slot_id, set_id, recommendation_text, enabled, display_order')
        .eq('enabled', true),

      supabase
        .from('equipment_slots')
        .select('id, name, slug, display_order')
        .order('display_order'),

      supabase
        .from('equipment_sets')
        .select('id, name, slug, description'),

      supabase
        .from('equipment_rarity_levels')
        .select('equipment_id, rarity_slug, rarity_name, rarity_order, rarity_color, stats')
        .order('rarity_order'),

      supabase
        .from('equipment_set_bonuses')
        .select('id, set_id, required_pieces, title, description, display_order')
        .order('required_pieces')
    ]);

    if (equipmentsResult.error) throw equipmentsResult.error;

    equipments = equipmentsResult.data ?? [];

    slots = new Map((slotsResult.data ?? []).map(item => [item.id, item]));
    sets = new Map((setsResult.data ?? []).map(item => [item.id, item]));

    levelsByEquipment = new Map();
    rarities = new Map();

    (levelsResult.data ?? []).forEach(level => {
      if (!levelsByEquipment.has(level.equipment_id)) {
        levelsByEquipment.set(level.equipment_id, []);
      }

      levelsByEquipment.get(level.equipment_id).push(level);

      if (!rarities.has(level.rarity_slug)) {
        rarities.set(level.rarity_slug, {
          slug: level.rarity_slug,
          name: level.rarity_name,
          color: level.rarity_color,
          order: level.rarity_order
        });
      }
    });

    bonusesBySet = new Map();

    (bonusesResult.data ?? []).forEach(bonus => {
      if (!bonusesBySet.has(bonus.set_id)) bonusesBySet.set(bonus.set_id, []);
      bonusesBySet.get(bonus.set_id).push(bonus);
    });

    renderSlotFilters();
    renderRarityOptions();
    renderGrid();
  } catch (error) {
    console.error('Erro ao carregar equipamentos:', error);
    grid.innerHTML = '<div class="loading-card">Não foi possível carregar os equipamentos.</div>';
    countLabel.textContent = '—';
  }
}

await load();

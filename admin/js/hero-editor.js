import { supabase } from '../../js/supabase.js';

const STORAGE_BUCKET = 'game-media';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const IMPORT_KEY = 'hero-import-draft';
const SAVE_RECEIPT_KEY = 'hero-save-success-receipt';
const IMPORT_SCHEMA_VERSION = 1;

const params = new URLSearchParams(location.search);
const heroId = params.get('id');

const form = document.getElementById('hero-form');
const message = document.getElementById('message');
const saveButton = document.getElementById('save-hero-button');

const fields = {
  name: document.getElementById('name'),
  slug: document.getElementById('slug'),
  classId: document.getElementById('class-id'),
  rarityId: document.getElementById('rarity-id'),
  faction: document.getElementById('faction'),
  displayOrder: document.getElementById('display-order'),
  description: document.getElementById('description'),
  enabled: document.getElementById('enabled'),
  imageFile: document.getElementById('image-file'),
  cardFile: document.getElementById('card-file'),
  gifFile: document.getElementById('gif-file')
};

const previewElements = {
  live: document.getElementById('hero-live-preview'),
  name: document.getElementById('preview-name'),
  slug: document.getElementById('preview-slug'),
  description: document.getElementById('preview-description'),
  enabled: document.getElementById('preview-enabled')
};


const integratedStats = {
  heroGrid: document.getElementById('hero-stats-grid'),
  weaponGrid: document.getElementById('weapon-stats-grid'),
  heroPreview: document.getElementById('hero-stats-preview'),
  weaponPreview: document.getElementById('weapon-stats-preview'),
  weaponName: document.getElementById('weapon-name'),
  applyImport: document.getElementById('apply-imported-stats'),
  undoImport: document.getElementById('undo-imported-stats')
};

const HERO_STAT_CATEGORIES = new Set([
  'hero',
  'defense',
  'utility'
]);

const WEAPON_STAT_CATEGORIES = new Set([
  'weapon',
  'offense',
  'ability'
]);

const STAT_IMPORT_ALIASES = {
  hero: {
    power: ['power', 'hero_power', 'poder', 'poder geral'],
    health: ['health', 'life', 'hp', 'vida', 'vida total'],
    damage: ['damage', 'hero_damage', 'dano', 'dano do heroi'],
    armor: ['armor', 'armour', 'armadura', 'armadura total'],
    visionRange: ['vision_range', 'visionrange', 'alcance de visao', 'visao'],
    movementNoiseRadius: ['movement_noise_radius', 'noise_radius', 'raio do barulho', 'barulho de movimentacao'],
    maxMovementSpeed: ['max_movement_speed', 'movement_speed', 'velocidade maxima'],
    aimedMovementSpeed: ['aimed_movement_speed', 'movement_speed_aiming', 'velocidade ao mirar'],
    penetrationResistance: ['penetration_resistance', 'resistencia a perfuracao'],
    armorValue: ['armor_value', 'valor de armadura', 'valor da armadura'],
    armorResistance: ['armor_resistance', 'resistencia de armadura']
  },

  weapon: {
    firepower: ['firepower', 'weapon_firepower', 'poder de fogo'],
    armorBreak: ['armor_break', 'armorbreak', 'quebra de armadura'],
    fireRate: ['fire_rate', 'firerate', 'cadencia', 'cadencia de tiro'],
    magazineCapacity: ['magazine_capacity', 'ammo_capacity', 'capacidade de municao'],
    effectiveRange: ['effective_range', 'alcance efetivo'],
    aimingStability: ['aiming_stability', 'estabilidade de mira'],
    damagePerShot: ['damage_per_shot', 'weapon_damage', 'dano por tiro'],
    healthDamageMultiplier: ['health_damage_multiplier', 'modificador contra vida'],
    armorPenetration: ['armor_penetration', 'perfuracao de armadura'],
    penetrationPower: ['penetration_power', 'poder de perfuracao'],
    armorDroneMultiplier: ['armor_drone_multiplier', 'modificador contra armadura e drones'],
    shotsPerSecond: ['shots_per_second', 'tiros por segundo'],
    reloadTime: ['reload_time', 'tempo de recarga'],
    magazineSize: ['magazine_size', 'tamanho do pente'],
    hipFireRange: ['hip_fire_range', 'alcance sem mira'],
    aimedRange: ['aimed_range', 'alcance com mira'],
    dispersion: ['dispersion', 'dispersao'],
    movingDispersion: ['moving_dispersion', 'dispersao em movimento'],
    aimedDispersion: ['aimed_dispersion', 'dispersao com mira'],
    aimTime: ['aim_time', 'tempo de mira'],
    dispersionFactor: ['dispersion_factor', 'fator de dispersao']
  }
};

let statDefinitions = [];
let importedStatsSnapshot = null;

let currentHero = null;
let isSaving = false;
let pendingUpdate = null;
let mainEditor;
let cardEditor;
let gifEditor;

function showMessage(text = '', type = '') {
  if (!message) return;
  message.textContent = text;
  message.className = type;
}

function clearSaveReceipt() {
  sessionStorage.removeItem(SAVE_RECEIPT_KEY);
}

function storeSaveReceipt(options) {
  sessionStorage.setItem(SAVE_RECEIPT_KEY, JSON.stringify({
    ...options,
    savedAt: Date.now()
  }));
}

function readSaveReceipt() {
  try {
    const receipt = JSON.parse(sessionStorage.getItem(SAVE_RECEIPT_KEY) || 'null');
    if (!receipt?.id || Date.now() - Number(receipt.savedAt || 0) > 30 * 60 * 1000) {
      clearSaveReceipt();
      return null;
    }
    return receipt;
  } catch {
    clearSaveReceipt();
    return null;
  }
}

function ensureSaveSuccessUi() {
  if (document.getElementById('hero-save-success')) return;

  const style = document.createElement('style');
  style.id = 'hero-save-success-style';
  style.textContent = `
    body.hero-success-open{overflow:hidden}
    .hero-save-success{
      position:fixed;inset:0;z-index:12000;display:none;place-items:center;
      padding:20px;background:rgba(2,7,16,.9);backdrop-filter:blur(10px)
    }
    .hero-save-success.is-open{display:grid}
    .hero-save-success-card{
      position:relative;width:min(520px,100%);overflow:hidden;text-align:center;
      padding:34px;border:1px solid rgba(74,222,128,.38);border-radius:22px;
      background:linear-gradient(160deg,#0d1c27,#08111f 65%);
      box-shadow:0 30px 100px rgba(0,0,0,.68),0 0 45px rgba(74,222,128,.1)
    }
    .hero-save-success-card::before{
      content:'';position:absolute;inset:0 0 auto;height:4px;
      background:linear-gradient(90deg,#22c55e,#86efac,#22c55e)
    }
    .hero-success-icon{
      width:82px;height:82px;margin:0 auto 18px;display:grid;place-items:center;
      border:2px solid #4ade80;border-radius:50%;background:rgba(34,197,94,.12);
      color:#86efac;font-size:42px;font-weight:900;
      box-shadow:0 0 0 10px rgba(34,197,94,.05)
    }
    .hero-success-eyebrow{
      color:#86efac;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase
    }
    .hero-save-success h2{margin:9px 0 7px;font-size:28px;color:#fff}
    .hero-save-success p{margin:0;color:#aeb9ca;font-size:13px;line-height:1.6}
    .hero-success-name{
      margin:20px 0 0;padding:15px;border:1px solid #26384a;border-radius:12px;
      background:#08101d;color:#fff;font-size:18px;font-weight:900
    }
    .hero-success-details{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px
    }
    .hero-success-details span{
      padding:10px;border:1px solid #203247;border-radius:9px;background:#0a1422;
      color:#9facc0;font-size:11px
    }
    .hero-success-actions{display:flex;justify-content:center;gap:9px;flex-wrap:wrap;margin-top:24px}
    @media(max-width:520px){
      .hero-save-success{padding:0}.hero-save-success-card{min-height:100vh;border-radius:0;display:grid;align-content:center}
      .hero-success-actions{display:grid}.hero-success-actions .admin-button{width:100%}
    }
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.id = 'hero-save-success';
  backdrop.className = 'hero-save-success';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <section class="hero-save-success-card" role="alertdialog" aria-modal="true" aria-labelledby="hero-success-title">
      <div class="hero-success-icon">✓</div>
      <div class="hero-success-eyebrow" id="hero-success-eyebrow">Operação concluída</div>
      <h2 id="hero-success-title">Herói salvo com sucesso!</h2>
      <p id="hero-success-copy">Todos os dados foram enviados e confirmados.</p>
      <div id="hero-success-name" class="hero-success-name"></div>
      <div id="hero-success-details" class="hero-success-details"></div>
      <div class="hero-success-actions">
        <button id="hero-success-continue" type="button" class="admin-button">Continuar editando</button>
        <a id="hero-success-list" class="admin-button" href="./heroes.html">Voltar à lista</a>
        <a id="hero-success-open" class="admin-button primary" href="#">Abrir herói salvo</a>
      </div>
    </section>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('hero-success-continue').addEventListener('click', () => {
    clearSaveReceipt();
    backdrop.classList.remove('is-open');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('hero-success-open');
  });
  document.getElementById('hero-success-list').addEventListener('click', clearSaveReceipt);
  document.getElementById('hero-success-open').addEventListener('click', clearSaveReceipt);
}

function showSaveSuccess({ id, name, updated = false, details = [] }) {
  ensureSaveSuccessUi();
  const backdrop = document.getElementById('hero-save-success');
  document.getElementById('hero-success-eyebrow').textContent =
    updated ? 'Atualização concluída' : 'Cadastro concluído';
  document.getElementById('hero-success-title').textContent =
    updated ? 'Herói atualizado com sucesso!' : 'Herói salvo com sucesso!';
  document.getElementById('hero-success-copy').textContent =
    updated
      ? 'As alterações foram confirmadas no banco de dados.'
      : 'O cadastro, os status e os dados da arma foram confirmados no banco de dados.';
  document.getElementById('hero-success-name').textContent = name || 'Herói';
  document.getElementById('hero-success-details').innerHTML =
    (details.length ? details : ['✓ Dados gerais salvos', '✓ Status e arma salvos'])
      .map(item => `<span>${escapeHtml(item)}</span>`).join('');
  const openLink = document.getElementById('hero-success-open');
  openLink.href = `./hero-editor.html?id=${encodeURIComponent(id)}&tab=stats`;
  document.getElementById('hero-success-continue').style.display = heroId ? '' : 'none';
  backdrop.classList.add('is-open');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('hero-success-open');
  openLink.focus();
  repairDocumentEncoding(backdrop);
}

function announceSaveSuccess(options) {
  storeSaveReceipt(options);
  try {
    showSaveSuccess(options);
  } catch (error) {
    console.error('Falha ao abrir confirmação visual:', error);
    window.alert(
      `✓ ${options.updated ? 'Herói atualizado' : 'Herói salvo'} com sucesso!\n\n` +
      `${options.name || 'Herói'}\n\nOs dados foram confirmados no banco de dados.`
    );
  }
}

function restorePendingSaveSuccess() {
  const receipt = readSaveReceipt();
  if (!receipt) return false;
  showSaveSuccess(receipt);
  return true;
}

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFilename(filename = '') {
  const extension = filename.includes('.')
    ? filename.split('.').pop().toLowerCase()
    : '';

  const basename = filename
    .replace(/\.[^/.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return extension ? `${basename}.${extension}` : basename;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  let normalized = value;
  if (typeof value === 'string') {
    const cleaned = value.replace(',', '.').trim();
    const match = cleaned.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/);
    normalized = match ? match[0] : cleaned;
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function repairMojibake(value = '') {
  const text = String(value);
  if (!/[ÃÂâ]/.test(text)) return text;
  try {
    const windows1252 = new Map([
      ['€',0x80],['‚',0x82],['ƒ',0x83],['„',0x84],['…',0x85],['†',0x86],
      ['‡',0x87],['ˆ',0x88],['‰',0x89],['Š',0x8a],['‹',0x8b],['Œ',0x8c],
      ['Ž',0x8e],['‘',0x91],['’',0x92],['“',0x93],['”',0x94],['•',0x95],
      ['–',0x96],['—',0x97],['˜',0x98],['™',0x99],['š',0x9a],['›',0x9b],
      ['œ',0x9c],['ž',0x9e],['Ÿ',0x9f]
    ]);
    const bytes = Uint8Array.from(text, character =>
      windows1252.get(character) ?? (character.charCodeAt(0) & 255)
    );
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return repaired.includes('\uFFFD') ? text : repaired;
  } catch {
    return text;
  }
}

function repairDocumentEncoding(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const repaired = repairMojibake(node.nodeValue);
    if (repaired !== node.nodeValue) node.nodeValue = repaired;
  });
  root.querySelectorAll?.('[placeholder],[title],[aria-label]').forEach(element => {
    for (const attribute of ['placeholder', 'title', 'aria-label']) {
      if (!element.hasAttribute(attribute)) continue;
      const current = element.getAttribute(attribute);
      const repaired = repairMojibake(current);
      if (repaired !== current) element.setAttribute(attribute, repaired);
    }
  });
}

function bindEncodingRepairObserver() {
  const observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const repaired = repairMojibake(node.nodeValue);
          if (repaired !== node.nodeValue) node.nodeValue = repaired;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          repairDocumentEncoding(node);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function createUniqueId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPublicUrl(path) {
  if (!path) return '';
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

function validateFile(file, allowedTypes) {
  if (!file) return;
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Formato não permitido para "${file.name}".`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`"${file.name}" deve ter no máximo 25 MB.`);
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setFieldValue(field, value, eventName = 'input') {
  if (!field || value === null || value === undefined) return;

  if (field.type === 'checkbox') {
    field.checked = Boolean(value);
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  field.value = String(value);
  field.dispatchEvent(new Event(eventName, { bubbles: true }));

  if (eventName !== 'change') {
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/* =========================================================
   EDITOR DE MÍDIA
========================================================= */

function createMediaEditor({
  name,
  input,
  canvas,
  image,
  zoom,
  zoomValue,
  centerButton,
  resetButton,
  allowedTypes,
  objectFit = 'cover',
  onChange
}) {
  const state = {
    source: '',
    objectUrl: '',
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    pointerId: null,
    pointerStartX: 0,
    pointerStartY: 0,
    originalOffsetX: 0,
    originalOffsetY: 0
  };

  function notifyChange() {
    if (typeof onChange === 'function') onChange(api);
  }

  function revokeObjectUrl() {
    if (!state.objectUrl) return;
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = '';
  }

  function applyBaseLayout() {
    if (!image) return;
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = objectFit;
    image.style.objectPosition = '50% 50%';
  }

  function updateTransform() {
    if (!image) return;

    state.scale = clamp(toNumber(state.scale, 1), 0.5, 3);
    state.offsetX = clamp(toNumber(state.offsetX, 0), -100, 100);
    state.offsetY = clamp(toNumber(state.offsetY, 0), -100, 100);

    image.style.transform =
      `translate(${-50 + state.offsetX}%, ${-50 + state.offsetY}%) scale(${state.scale})`;

    if (zoom) zoom.value = String(state.scale);
    if (zoomValue) zoomValue.textContent = `${Math.round(state.scale * 100)}%`;

    notifyChange();
  }

  function setSource(
    source,
    { scale = 1, offsetX = 0, offsetY = 0, isObjectUrl = false } = {}
  ) {
    if (!source) {
      clear();
      return;
    }

    if (!isObjectUrl) revokeObjectUrl();

    state.source = source;
    state.scale = clamp(toNumber(scale, 1), 0.5, 3);
    state.offsetX = clamp(toNumber(offsetX, 0), -100, 100);
    state.offsetY = clamp(toNumber(offsetY, 0), -100, 100);

    image.onload = () => {
      applyBaseLayout();
      canvas.classList.add('has-image');
      updateTransform();
    };

    image.onerror = () => {
      console.warn(`Não foi possível carregar a mídia "${name}".`);
      canvas.classList.remove('has-image');
    };

    image.src = source;
  }

  function setFile(file) {
    if (!file) return;
    validateFile(file, allowedTypes);
    revokeObjectUrl();
    state.objectUrl = URL.createObjectURL(file);
    setSource(state.objectUrl, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      isObjectUrl: true
    });
  }

  function center() {
    state.offsetX = 0;
    state.offsetY = 0;
    updateTransform();
  }

  function reset() {
    state.scale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    updateTransform();
  }

  function clear() {
    revokeObjectUrl();

    state.source = '';
    state.scale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    state.dragging = false;
    state.pointerId = null;

    canvas?.classList.remove('has-image', 'is-dragging');
    image?.removeAttribute('src');

    if (zoom) zoom.value = '1';
    if (zoomValue) zoomValue.textContent = '100%';

    notifyChange();
  }

  function getState() {
    return {
      source: state.source,
      scale: Number(state.scale.toFixed(3)),
      offsetX: Math.round(state.offsetX),
      offsetY: Math.round(state.offsetY),
      objectFit
    };
  }

  function getSource() {
    return state.source;
  }

  function resize() {
    if (!state.source) return;
    applyBaseLayout();
    updateTransform();
  }

  function bind() {
    if (!canvas || !image || !input) {
      console.warn(`Editor de mídia incompleto: ${name}`);
      return;
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        setFile(file);
      } catch (error) {
        input.value = '';
        showMessage(error.message, 'error');
      }
    });

    zoom?.addEventListener('input', event => {
      state.scale = toNumber(event.target.value, 1);
      updateTransform();
    });

    centerButton?.addEventListener('click', center);
    resetButton?.addEventListener('click', reset);

    canvas.addEventListener('pointerdown', event => {
      if (!state.source) return;

      state.dragging = true;
      state.pointerId = event.pointerId;
      state.pointerStartX = event.clientX;
      state.pointerStartY = event.clientY;
      state.originalOffsetX = state.offsetX;
      state.originalOffsetY = state.offsetY;

      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
    });

    canvas.addEventListener('pointermove', event => {
      if (!state.dragging || event.pointerId !== state.pointerId) return;

      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;

      state.offsetX =
        state.originalOffsetX +
        ((event.clientX - state.pointerStartX) / width) * 100;

      state.offsetY =
        state.originalOffsetY +
        ((event.clientY - state.pointerStartY) / height) * 100;

      updateTransform();
    });

    function stopDragging(event) {
      if (event.pointerId !== state.pointerId) return;

      state.dragging = false;
      state.pointerId = null;
      canvas.classList.remove('is-dragging');

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }

    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
  }

  const api = {
    bind,
    setSource,
    setFile,
    center,
    reset,
    clear,
    resize,
    getState,
    getSource
  };

  bind();
  return api;
}

function createAllMediaEditors() {
  const sharedImageTypes = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ];

  mainEditor = createMediaEditor({
    name: 'imagem principal',
    input: fields.imageFile,
    canvas: document.getElementById('main-image-canvas'),
    image: document.getElementById('main-image-element'),
    zoom: document.getElementById('main-image-zoom'),
    zoomValue: document.getElementById('main-image-zoom-value'),
    centerButton: document.getElementById('main-image-center'),
    resetButton: document.getElementById('main-image-reset'),
    allowedTypes: sharedImageTypes,
    objectFit: 'contain',
    onChange: updateLivePreview
  });

  cardEditor = createMediaEditor({
    name: 'imagem do card',
    input: fields.cardFile,
    canvas: document.getElementById('card-image-canvas'),
    image: document.getElementById('card-image-element'),
    zoom: document.getElementById('card-image-zoom'),
    zoomValue: document.getElementById('card-image-zoom-value'),
    centerButton: document.getElementById('card-image-center'),
    resetButton: document.getElementById('card-image-reset'),
    allowedTypes: sharedImageTypes,
    objectFit: 'cover'
  });

  gifEditor = createMediaEditor({
    name: 'GIF animado',
    input: fields.gifFile,
    canvas: document.getElementById('gif-image-canvas'),
    image: document.getElementById('gif-image-element'),
    zoom: document.getElementById('gif-image-zoom'),
    zoomValue: document.getElementById('gif-image-zoom-value'),
    centerButton: document.getElementById('gif-image-center'),
    resetButton: document.getElementById('gif-image-reset'),
    allowedTypes: ['image/gif'],
    objectFit: 'cover'
  });
}

/* =========================================================
   PRÉVIA E EVENTOS
========================================================= */

function updateInformationPreview() {
  if (previewElements.name) {
    previewElements.name.textContent =
      fields.name?.value.trim() || 'Novo herói';
  }

  if (previewElements.slug) {
    previewElements.slug.textContent =
      fields.slug?.value.trim() || '—';
  }

  if (previewElements.description) {
    previewElements.description.textContent =
      fields.description?.value.trim() || 'Nenhuma descrição cadastrada.';
  }

  if (previewElements.enabled) {
    previewElements.enabled.textContent =
      fields.enabled?.checked ? 'Ativo' : 'Inativo';
  }
}

function updateLivePreview() {
  const container = previewElements.live;
  if (!container || !mainEditor) return;

  const source = mainEditor.getSource();
  const state = mainEditor.getState();

  if (!source) {
    container.textContent = 'Sem mídia selecionada';
    return;
  }

  container.innerHTML = `
    <div style="position:relative;width:100%;height:100%;overflow:hidden">
      <img
        src="${source}"
        alt=""
        style="
          position:absolute;
          left:50%;
          top:50%;
          width:100%;
          height:100%;
          object-fit:${state.objectFit};
          object-position:50% 50%;
          pointer-events:none;
          transform:
            translate(${-50 + state.offsetX}%, ${-50 + state.offsetY}%)
            scale(${state.scale});
          transform-origin:center center;
        "
      >
    </div>
  `;
}

function updateAllPreviews() {
  updateInformationPreview();
  updateLivePreview();
}

function bindAutomaticSlug() {
  fields.name?.addEventListener('input', () => {
    fields.slug.value = slugify(fields.name.value);
    updateInformationPreview();
  });
}

function bindGeneralPreview() {
  fields.description?.addEventListener('input', updateInformationPreview);
  fields.enabled?.addEventListener('change', updateInformationPreview);
}

/* =========================================================
   CLASSES E ORDEM
========================================================= */

async function loadHeroClasses() {
  let result = await supabase
    .from('hero_classes')
    .select('id,name,slug')
    .order('name');

  if (result.error) {
    result = await supabase
      .from('classes')
      .select('id,name,slug')
      .order('name');
  }

  if (result.error) {
    console.warn('Não foi possível carregar as classes:', result.error);
    return;
  }

  const classes = result.data ?? [];

  fields.classId.innerHTML = `
    <option value="">Sem classe</option>
    ${classes.map(heroClass => `
      <option
        value="${heroClass.id}"
        data-slug="${heroClass.slug || ''}"
      >${heroClass.name}</option>
    `).join('')}
  `;
}

async function loadHeroRarities() {
  const { data, error } = await supabase
    .from('hero_rarities')
    .select('id,name,slug,rank,color')
    .order('rank', { ascending: true });

  if (error) {
    throw error;
  }

  const rarities = data || [];

  if (!fields.rarityId) {
    return;
  }

  fields.rarityId.innerHTML = `
    <option value="">Sem raridade</option>
    ${rarities.map(rarity => `
      <option
        value="${rarity.id}"
        data-slug="${rarity.slug || ''}"
        data-color="${rarity.color || ''}"
      >${rarity.name}</option>
    `).join('')}
  `;
}

async function loadNextDisplayOrder() {
  if (heroId) return;

  const { data, error } = await supabase
    .from('heroes')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('Não foi possível calcular a ordem:', error);
    fields.displayOrder.value = '0';
    return;
  }

  const highestOrder = toNumber(data?.[0]?.display_order, -1);
  fields.displayOrder.value = String(highestOrder + 1);
}


/* =========================================================
   STATUS E ARMA INTEGRADOS
========================================================= */

function getStatInputStep(definition) {
  const decimals = Math.max(0, toNumber(definition.decimals, 0));
  return decimals === 0
    ? '1'
    : String(1 / Math.pow(10, decimals));
}

function formatIntegratedStatValue(value, definition = {}) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '—';
  }

  const decimals = Math.max(0, toNumber(definition.decimals, 0));

  const formatted = number.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  if (!definition.unit) return formatted;
  if (definition.unit === 'x') return `x${formatted}`;
  return `${formatted}${definition.unit}`;
}

function getIntegratedDefinitions(group) {
  const categories =
    group === 'hero'
      ? HERO_STAT_CATEGORIES
      : WEAPON_STAT_CATEGORIES;

  return statDefinitions.filter(definition =>
    categories.has(definition.category)
  );
}

function createIntegratedStatField(definition, group, currentValue = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'integrated-stat-field stat-field';
  wrapper.dataset.statKey = definition.key;
  wrapper.dataset.group = group;

  const label = document.createElement('label');
  const labelText = document.createElement('span');
  labelText.textContent = definition.name || definition.key;
  label.appendChild(labelText);

  if (definition.unit) {
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = definition.unit;
    label.appendChild(unit);
  }

  const description = document.createElement('small');
  description.textContent = definition.description || '';

  const input = document.createElement('input');
  input.type = 'number';
  input.step =
    definition.value_type === 'integer'
      ? '1'
      : getStatInputStep(definition);

  input.value =
    currentValue === null || currentValue === undefined
      ? ''
      : String(currentValue);

  input.placeholder = '0';
  input.addEventListener('input', renderIntegratedStatsPreview);

  wrapper.append(label, description, input);
  return wrapper;
}

function renderIntegratedStatsFields(heroValues = {}, weaponValues = {}) {
  const heroDefinitions = getIntegratedDefinitions('hero');
  const weaponDefinitions = getIntegratedDefinitions('weapon');

  if (integratedStats.heroGrid) {
    integratedStats.heroGrid.innerHTML = '';

    if (!heroDefinitions.length) {
      integratedStats.heroGrid.innerHTML = `
        <div class="integrated-stats-empty">
          Nenhuma definição de status do herói foi encontrada.
        </div>
      `;
    } else {
      heroDefinitions.forEach(definition => {
        integratedStats.heroGrid.appendChild(
          createIntegratedStatField(
            definition,
            'hero',
            heroValues[definition.key] ?? ''
          )
        );
      });
    }
  }

  if (integratedStats.weaponGrid) {
    integratedStats.weaponGrid.innerHTML = '';

    if (!weaponDefinitions.length) {
      integratedStats.weaponGrid.innerHTML = `
        <div class="integrated-stats-empty">
          Nenhuma definição de status da arma foi encontrada.
        </div>
      `;
    } else {
      weaponDefinitions.forEach(definition => {
        integratedStats.weaponGrid.appendChild(
          createIntegratedStatField(
            definition,
            'weapon',
            weaponValues[definition.key] ?? ''
          )
        );
      });
    }
  }

  renderIntegratedStatsPreview();
}

function collectIntegratedStatFields(group) {
  return [
    ...document.querySelectorAll(
      `.stat-field[data-group="${group}"]`
    )
  ]
    .map(field => {
      const input = field.querySelector('input');
      const rawValue = input?.value.trim() ?? '';

      return {
        stat_key: field.dataset.statKey,
        rawValue
      };
    })
    .filter(item => item.stat_key && item.rawValue !== '')
    .map(item => {
      const value = Number(item.rawValue);

      if (!Number.isFinite(value)) {
        throw new Error(`Valor inválido em "${item.stat_key}".`);
      }

      return {
        stat_key: item.stat_key,
        value
      };
    });
}

function renderIntegratedPreviewGroup(group, container) {
  if (!container) return;

  const fields = [
    ...document.querySelectorAll(
      `.stat-field[data-group="${group}"]`
    )
  ].filter(field => {
    const input = field.querySelector('input');
    return input && input.value.trim() !== '';
  });

  if (!fields.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = fields
    .map(field => {
      const statKey = field.dataset.statKey;
      const definition = statDefinitions.find(item => item.key === statKey);
      const value = field.querySelector('input').value;

      return `
        <div class="integrated-preview-stat">
          <span>${escapeHtml(definition?.name || statKey)}</span>
          <strong>${escapeHtml(
            formatIntegratedStatValue(value, definition || {})
          )}</strong>
        </div>
      `;
    })
    .join('');
}

function renderIntegratedStatsPreview() {
  renderIntegratedPreviewGroup(
    'hero',
    integratedStats.heroPreview
  );

  renderIntegratedPreviewGroup(
    'weapon',
    integratedStats.weaponPreview
  );
}

async function loadStatDefinitions() {
  const { data, error } = await supabase
    .from('stat_definitions')
    .select(`
      key,
      name,
      category,
      unit,
      value_type,
      decimals,
      higher_is_better,
      description,
      display_order
    `)
    .eq('enabled', true)
    .order('display_order', {
      ascending: true
    });

  if (error) throw error;

  statDefinitions = data || [];
  renderIntegratedStatsFields();
}

async function loadIntegratedStats(targetHeroId) {
  if (!targetHeroId) {
    renderIntegratedStatsFields();
    if (integratedStats.weaponName) {
      integratedStats.weaponName.value = '';
    }
    return;
  }

  const [
    heroStatsResult,
    weaponStatsResult
  ] = await Promise.all([
    supabase
      .from('hero_base_stats')
      .select('stat_key,value')
      .eq('hero_id', targetHeroId),

    supabase
      .from('hero_weapon_stats')
      .select('stat_key,value,weapon_name')
      .eq('hero_id', targetHeroId)
  ]);

  if (heroStatsResult.error) throw heroStatsResult.error;
  if (weaponStatsResult.error) throw weaponStatsResult.error;

  const heroValues = Object.fromEntries(
    (heroStatsResult.data || []).map(row => [
      row.stat_key,
      row.value
    ])
  );

  const weaponValues = Object.fromEntries(
    (weaponStatsResult.data || []).map(row => [
      row.stat_key,
      row.value
    ])
  );

  renderIntegratedStatsFields(
    heroValues,
    weaponValues
  );

  if (integratedStats.weaponName) {
    integratedStats.weaponName.value =
      weaponStatsResult.data?.[0]?.weapon_name || '';
  }
}

async function getExistingIntegratedStatKeys(table, targetHeroId) {
  const { data, error } = await supabase
    .from(table)
    .select('stat_key')
    .eq('hero_id', targetHeroId);

  if (error) throw error;

  return (data || []).map(row => row.stat_key);
}

async function syncIntegratedStats(
  table,
  targetHeroId,
  rows,
  extra = {}
) {
  const existingKeys =
    await getExistingIntegratedStatKeys(
      table,
      targetHeroId
    );

  const incomingKeys =
    rows.map(row => row.stat_key);

  if (rows.length) {
    const payload = rows.map(row => ({
      hero_id: targetHeroId,
      stat_key: row.stat_key,
      value: row.value,
      ...extra
    }));

    const { error: upsertError } = await supabase
      .from(table)
      .upsert(payload, {
        onConflict: 'hero_id,stat_key'
      });

    if (upsertError) throw upsertError;
  }

  const removedKeys = existingKeys.filter(
    key => !incomingKeys.includes(key)
  );

  if (removedKeys.length) {
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq('hero_id', targetHeroId)
      .in('stat_key', removedKeys);

    if (deleteError) throw deleteError;
  }
}

async function saveIntegratedStats(targetHeroId) {
  const heroRows =
    collectIntegratedStatFields('hero');

  const weaponRows =
    collectIntegratedStatFields('weapon');

  const weaponName =
    integratedStats.weaponName?.value.trim() ||
    null;

  await syncIntegratedStats(
    'hero_base_stats',
    targetHeroId,
    heroRows
  );

  await syncIntegratedStats(
    'hero_weapon_stats',
    targetHeroId,
    weaponRows,
    {
      weapon_name: weaponName
    }
  );

  importedStatsSnapshot = null;
  updateIntegratedUndoButton();
}

function scoreIntegratedDefinitionMatch(definition, aliases) {
  const key = normalizeText(definition.key);
  const name = normalizeText(definition.name);
  let bestScore = 0;

  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) continue;

    if (key === normalizedAlias || name === normalizedAlias) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    if (
      key.replace(/\s/g, '') === normalizedAlias.replace(/\s/g, '') ||
      name.replace(/\s/g, '') === normalizedAlias.replace(/\s/g, '')
    ) {
      bestScore = Math.max(bestScore, 95);
      continue;
    }

    if (
      key.includes(normalizedAlias) ||
      name.includes(normalizedAlias) ||
      normalizedAlias.includes(key) ||
      normalizedAlias.includes(name)
    ) {
      bestScore = Math.max(bestScore, 70);
    }
  }

  return bestScore;
}

function findIntegratedDefinition(group, aliases) {
  const categories =
    group === 'hero'
      ? HERO_STAT_CATEGORIES
      : WEAPON_STAT_CATEGORIES;

  return statDefinitions
    .filter(definition =>
      categories.has(definition.category)
    )
    .map(definition => ({
      definition,
      score: scoreIntegratedDefinitionMatch(
        definition,
        aliases
      )
    }))
    .filter(item => item.score > 0)
    .sort((first, second) =>
      second.score - first.score
    )[0]?.definition || null;
}

function getIntegratedInput(group, definition) {
  if (!definition) return null;

  return document.querySelector(
    `.stat-field[data-group="${group}"][data-stat-key="${CSS.escape(definition.key)}"] input`
  );
}

function captureIntegratedStatsSnapshot() {
  const values = {};

  document
    .querySelectorAll('.stat-field')
    .forEach(field => {
      const input = field.querySelector('input');
      if (!input) return;

      values[
        `${field.dataset.group}:${field.dataset.statKey}`
      ] = input.value;
    });

  return {
    weaponName:
      integratedStats.weaponName?.value || '',
    values
  };
}

function restoreIntegratedStatsSnapshot(snapshot) {
  if (!snapshot) return;

  if (integratedStats.weaponName) {
    integratedStats.weaponName.value =
      snapshot.weaponName || '';
  }

  document
    .querySelectorAll('.stat-field')
    .forEach(field => {
      const input = field.querySelector('input');
      if (!input) return;

      const key =
        `${field.dataset.group}:${field.dataset.statKey}`;

      input.value =
        snapshot.values[key] ?? '';
    });

  renderIntegratedStatsPreview();
}

function updateIntegratedUndoButton() {
  if (integratedStats.undoImport) {
    integratedStats.undoImport.disabled =
      !importedStatsSnapshot;
  }
}

function hasImportedStatsData(data) {
  return Boolean(
    data?.status ||
    data?.weaponSummary ||
    data?.weaponDetails
  );
}

function applyImportedStatsData(data, {
  announce = false
} = {}) {
  if (!hasImportedStatsData(data)) {
    return {
      applied: 0,
      missing: []
    };
  }

  if (!importedStatsSnapshot) {
    importedStatsSnapshot =
      captureIntegratedStatsSnapshot();
    updateIntegratedUndoButton();
  }

  const heroSource = data.status || {};
  const weaponSource = {
    ...(data.weaponSummary || {}),
    ...(data.weaponDetails || {})
  };

  let applied = 0;
  const missing = [];

  for (const [sourceKey, aliases] of Object.entries(STAT_IMPORT_ALIASES.hero)) {
    const value = nullableNumber(heroSource[sourceKey]);
    if (value === null) continue;

    const definition =
      findIntegratedDefinition('hero', aliases);

    const input =
      getIntegratedInput('hero', definition);

    if (!definition || !input) {
      missing.push(`Herói: ${sourceKey}`);
      continue;
    }

    input.value = String(value);
    applied += 1;
  }

  for (const [sourceKey, aliases] of Object.entries(STAT_IMPORT_ALIASES.weapon)) {
    const value = nullableNumber(weaponSource[sourceKey]);
    if (value === null) continue;

    const definition =
      findIntegratedDefinition('weapon', aliases);

    const input =
      getIntegratedInput('weapon', definition);

    if (!definition || !input) {
      missing.push(`Arma: ${sourceKey}`);
      continue;
    }

    input.value = String(value);
    applied += 1;
  }

  const weaponName =
    data.weaponSummary?.name ||
    data.weaponDetails?.name ||
    null;

  if (weaponName && integratedStats.weaponName) {
    integratedStats.weaponName.value =
      String(weaponName);
    applied += 1;
  }

  renderIntegratedStatsPreview();

  if (announce) {
    let text =
      `${applied} campo(s) de status e arma preenchido(s).`;

    if (missing.length) {
      text +=
        ` ${missing.length} campo(s) não possuem definição correspondente.`;
    }

    showMessage(
      text,
      applied ? 'ok' : 'error'
    );
  }

  return {
    applied,
    missing
  };
}

function bindIntegratedStatsControls() {
  integratedStats.applyImport?.addEventListener(
    'click',
    () => {
      const stored = loadImportDraft();
      applyImportedStatsData(
        stored?.data,
        {
          announce: true
        }
      );
    }
  );

  integratedStats.undoImport?.addEventListener(
    'click',
    () => {
      if (!importedStatsSnapshot) {
        showMessage(
          'Não há preenchimento para desfazer.',
          'error'
        );
        return;
      }

      restoreIntegratedStatsSnapshot(
        importedStatsSnapshot
      );

      importedStatsSnapshot = null;
      updateIntegratedUndoButton();

      showMessage(
        'Os valores anteriores foram restaurados. Nada foi salvo.',
        'ok'
      );
    }
  );

  integratedStats.weaponName?.addEventListener(
    'input',
    renderIntegratedStatsPreview
  );
}

function refreshImportedStatsButton() {
  const stored = loadImportDraft();

  if (integratedStats.applyImport) {
    integratedStats.applyImport.hidden =
      !hasImportedStatsData(
        stored?.data
      );
  }
}


/* =========================================================
   IMPORTAÇÃO ASSISTIDA
========================================================= */

function getImportPrompt() {
  return `Analise os prints enviados de um herói do jogo Bullet Echo.

Extraia apenas os dados claramente visíveis. Não estime, não invente e não calcule valores ausentes. Quando um campo não estiver visível ou não puder ser confirmado, use null.

Responda SOMENTE com JSON válido, sem explicações antes ou depois:

{
  "schemaVersion": 1,
  "hero": {
    "name": null,
    "class": null,
    "description": null,
    "displayOrder": null,
    "active": true
  },
  "status": {
    "power": null,
    "health": null,
    "damage": null,
    "armor": null,
    "visionRange": null,
    "movementNoiseRadius": null,
    "maxMovementSpeed": null,
    "aimedMovementSpeed": null,
    "penetrationResistance": null,
    "armorValue": null,
    "armorResistance": null
  },
  "weaponSummary": {
    "name": null,
    "firepower": null,
    "armorBreak": null,
    "fireRate": null,
    "magazineCapacity": null,
    "effectiveRange": null,
    "aimingStability": null
  },
  "weaponDetails": {
    "damagePerShot": null,
    "healthDamageMultiplier": null,
    "armorPenetration": null,
    "penetrationPower": null,
    "armorDroneMultiplier": null,
    "shotsPerSecond": null,
    "reloadTime": null,
    "magazineSize": null,
    "hipFireRange": null,
    "aimedRange": null,
    "dispersion": null,
    "movingDispersion": null,
    "aimedDispersion": null,
    "aimTime": null,
    "dispersionFactor": null
  },
  "meta": {
    "rarity": null,
    "faction": null
  }
}

Regras:
- Preserve números decimais.
- Remova símbolos de unidade do valor numérico.
- Em "class", use o nome mostrado no jogo.
- Em "description", transcreva somente a descrição do herói.
- Nunca coloque texto fora do JSON.`;
}

function extractJsonText(value = '') {
  const text = String(value).trim();

  if (!text) {
    throw new Error('Cole o JSON retornado pelo ChatGPT.');
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error('Não foi encontrado um objeto JSON válido.');
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

function normalizeImportedData(source = {}) {
  const hero = source.hero && typeof source.hero === 'object'
    ? source.hero
    : source;

  const status = source.status && typeof source.status === 'object'
    ? source.status
    : (source.heroParameters || source.parametros_do_heroi || {});

  const overview = source.resumo && typeof source.resumo === 'object'
    ? source.resumo
    : {};

  const armaPt = source.arma && typeof source.arma === 'object'
    ? source.arma
    : {};

  const summary = source.weaponSummary && typeof source.weaponSummary === 'object'
    ? source.weaponSummary
    : (armaPt.resumo || {});

  const weapon = source.weaponDetails && typeof source.weaponDetails === 'object'
    ? source.weaponDetails
    : (source.weapon || armaPt || {});

  const detalhesPt = armaPt.detalhes && typeof armaPt.detalhes === 'object'
    ? armaPt.detalhes
    : {};

  const firepowerPt = detalhesPt.poder_de_fogo || {};
  const armorBreakPt = detalhesPt.quebra_de_armadura || {};
  const fireRatePt = detalhesPt.cadencia_de_tiro || {};
  const magazinePt = detalhesPt.capacidade_de_municao || {};
  const rangePt = detalhesPt.alcance_efetivo || {};
  const stabilityPt = detalhesPt.estabilidade_de_mira || {};

  const meta = source.meta && typeof source.meta === 'object'
    ? source.meta
    : {};

  return {
    schemaVersion: Number(source.schemaVersion) || IMPORT_SCHEMA_VERSION,

    hero: {
      name: hero.name ?? source.name ?? null,
      class: hero.class ?? hero.classe ?? hero.heroClass ?? source.heroClass ?? source.class ?? source.classe ?? null,
      description: hero.description ?? hero.descricao ?? source.description ?? source.descricao ?? null,
      displayOrder: nullableNumber(
        hero.displayOrder ?? hero.display_order ??
        source.displayOrder ?? source.display_order
      ),
      active: hero.active ?? hero.enabled ?? source.active ?? source.enabled ?? null
    },

    status: {
      power: nullableNumber(status.power ?? status.poder ?? overview.poder ?? source.power ?? source.poder),
      health: nullableNumber(status.health ?? status.life ?? status.vida ?? overview.vida ?? source.health ?? source.vida),
      damage: nullableNumber(status.damage ?? status.dano ?? overview.dano ?? source.damage ?? source.dano),
      armor: nullableNumber(status.armor ?? status.armadura ?? overview.armadura ?? source.armor ?? source.armadura),
      visionRange: nullableNumber(status.visionRange ?? status.vision_range ?? status.alcance_de_visao_do_heroi),
      movementNoiseRadius: nullableNumber(
        status.movementNoiseRadius ?? status.movement_noise_radius ??
        status.raio_maximo_do_barulho_de_movimentacao_do_heroi
      ),
      maxMovementSpeed: nullableNumber(
        status.maxMovementSpeed ?? status.max_movement_speed ??
        status.velocidade_maxima_de_movimentacao_do_heroi
      ),
      aimedMovementSpeed: nullableNumber(
        status.aimedMovementSpeed ?? status.aimed_movement_speed ??
        status.velocidade_maxima_de_movimentacao_do_heroi_ao_mirar
      ),
      penetrationResistance: nullableNumber(
        status.penetrationResistance ?? status.penetration_resistance ??
        status.resistencia_a_perfuracao_do_heroi
      ),
      armorValue: nullableNumber(status.armorValue ?? status.armor_value ?? status.valor_de_armadura),
      armorResistance: nullableNumber(
        status.armorResistance ?? status.armor_resistance ?? status.resistencia_de_armadura
      )
    },

    weaponSummary: {
      name: summary.name ?? summary.nome ?? weapon.name ?? weapon.nome ?? armaPt.nome ?? null,
      firepower: nullableNumber(summary.firepower ?? summary.poder_de_fogo ?? weapon.firepower),
      armorBreak: nullableNumber(
        summary.armorBreak ?? summary.armor_break ?? summary.quebra_de_armadura ?? weapon.armorBreak
      ),
      fireRate: nullableNumber(
        summary.fireRate ?? summary.fire_rate ?? summary.cadencia_de_tiro ?? weapon.fireRate
      ),
      magazineCapacity: nullableNumber(
        summary.magazineCapacity ??
        summary.magazine_capacity ??
        summary.capacidade_de_municao ??
        weapon.magazineCapacity
      ),
      effectiveRange: nullableNumber(
        summary.effectiveRange ?? summary.effective_range ?? summary.alcance_efetivo ?? weapon.effectiveRange
      ),
      aimingStability: nullableNumber(
        summary.aimingStability ??
        summary.aiming_stability ??
        summary.estabilidade_de_mira ??
        weapon.aimingStability
      )
    },

    weaponDetails: {
      damagePerShot: nullableNumber(
        weapon.damagePerShot ?? weapon.damage_per_shot ?? firepowerPt.dano_da_arma_por_tiro
      ),
      healthDamageMultiplier: nullableNumber(
        weapon.healthDamageMultiplier ?? weapon.health_damage_multiplier ?? firepowerPt.modificador_de_dano_a_vida
      ),
      armorPenetration: nullableNumber(
        weapon.armorPenetration ?? weapon.armor_penetration ?? firepowerPt.perfuracao_de_armadura_da_arma
      ),
      penetrationPower: nullableNumber(
        weapon.penetrationPower ?? weapon.penetration_power ?? armorBreakPt.poder_de_perfuracao_da_arma
      ),
      armorDroneMultiplier: nullableNumber(
        weapon.armorDroneMultiplier ?? weapon.armor_drone_multiplier ??
        armorBreakPt.modificador_de_dano_por_armas_a_armaduras_e_drones
      ),
      shotsPerSecond: nullableNumber(
        weapon.shotsPerSecond ?? weapon.shots_per_second ?? fireRatePt.cadencia_de_tiro_por_segundo
      ),
      reloadTime: nullableNumber(
        weapon.reloadTime ?? weapon.reload_time ?? fireRatePt.tempo_de_recarga_da_arma
      ),
      magazineSize: nullableNumber(
        weapon.magazineSize ?? weapon.magazine_size ?? magazinePt.tamanho_do_pente
      ),
      hipFireRange: nullableNumber(
        weapon.hipFireRange ?? weapon.hip_fire_range ?? rangePt.alcance_do_tiro_da_arma
      ),
      aimedRange: nullableNumber(
        weapon.aimedRange ?? weapon.aimed_range ?? rangePt.alcance_do_tiro_da_arma_ao_mirar
      ),
      dispersion: nullableNumber(weapon.dispersion ?? stabilityPt.dispersao_de_tiro_da_arma),
      movingDispersion: nullableNumber(
        weapon.movingDispersion ?? weapon.moving_dispersion ??
        stabilityPt.dispersao_de_tiro_da_arma_ao_se_movimentar
      ),
      aimedDispersion: nullableNumber(
        weapon.aimedDispersion ?? weapon.aimed_dispersion ??
        stabilityPt.dispersao_de_tiro_da_arma_ao_mirar
      ),
      aimTime: nullableNumber(
        weapon.aimTime ?? weapon.aim_time ?? stabilityPt.tempo_de_mira_da_arma
      ),
      dispersionFactor: nullableNumber(
        weapon.dispersionFactor ?? weapon.dispersion_factor ?? stabilityPt.fator_de_dispersao_da_arma
      )
    },

    meta: {
      level: meta.level ?? meta.nivel ?? hero.level ?? hero.nivel ?? source.level ?? source.nivel ?? null,
      rarity: meta.rarity ?? meta.raridade ?? hero.rarity ?? hero.raridade ?? source.rarity ?? source.raridade ?? null,
      faction: meta.faction ?? source.faction ?? null
    }
  };
}

function countValues(object) {
  return Object.values(object || {}).filter(
    value => value !== null && value !== undefined && value !== ''
  ).length;
}

function findClassOption(className) {
  if (!fields.classId || !className) return null;

  const wanted = normalizeText(className);
  const options = [...fields.classId.options];

  return options.find(option => {
    if (!option.value) return false;
    return (
      normalizeText(option.textContent) === wanted ||
      normalizeText(option.dataset.slug) === wanted
    );
  }) || options.find(option => {
    if (!option.value) return false;

    const text = normalizeText(option.textContent);
    const slug = normalizeText(option.dataset.slug);

    return (
      text.includes(wanted) ||
      wanted.includes(text) ||
      slug.includes(wanted) ||
      wanted.includes(slug)
    );
  }) || null;
}

function findRarityOption(rarityName) {
  if (!fields.rarityId || !rarityName) {
    return null;
  }

  const wanted = normalizeText(rarityName);
  const options = [...fields.rarityId.options];

  return options.find(option => {
    if (!option.value) {
      return false;
    }

    return (
      normalizeText(option.textContent) === wanted ||
      normalizeText(option.dataset.slug) === wanted
    );
  }) || options.find(option => {
    if (!option.value) {
      return false;
    }

    const text = normalizeText(option.textContent);
    const slug = normalizeText(option.dataset.slug);

    return (
      text.includes(wanted) ||
      wanted.includes(text) ||
      slug.includes(wanted) ||
      wanted.includes(slug)
    );
  }) || null;
}

function saveImportDraft(data) {
  sessionStorage.setItem(
    IMPORT_KEY,
    JSON.stringify({
      schemaVersion: IMPORT_SCHEMA_VERSION,
      importedAt: new Date().toISOString(),
      heroId: heroId || currentHero?.id || null,
      heroSlug: fields.slug?.value.trim() || null,
      data
    })
  );
}

function loadImportDraft() {
  try {
    const raw = sessionStorage.getItem(IMPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data ? parsed : null;
  } catch (error) {
    console.warn('Rascunho de importação inválido:', error);
    return null;
  }
}

function updateImportDraftAfterSave(savedHero, slug) {
  const stored = loadImportDraft();
  if (!stored) return;

  stored.heroId = savedHero?.id || heroId || null;
  stored.heroSlug = slug || savedHero?.slug || null;
  stored.heroName = savedHero?.name || fields.name?.value.trim() || null;
  stored.savedAt = new Date().toISOString();

  sessionStorage.setItem(IMPORT_KEY, JSON.stringify(stored));
}

function applyImportedData(data) {
  const applied = [];
  const warnings = [];
  const hero = data.hero || {};

  if (hero.name) {
    setFieldValue(fields.name, hero.name, 'input');
    applied.push('nome');
  }

  if (hero.class) {
    const option = findClassOption(hero.class);

    if (option) {
      fields.classId.value = option.value;
      fields.classId.dispatchEvent(new Event('change', { bubbles: true }));
      applied.push('classe');
    } else {
      warnings.push(`Classe "${hero.class}" não encontrada.`);
    }
  }

  if (hero.description) {
    setFieldValue(fields.description, hero.description, 'input');
    applied.push('descrição');
  }

  if (data.meta?.rarity) {
    const rarityOption = findRarityOption(data.meta.rarity);

    if (rarityOption) {
      fields.rarityId.value = rarityOption.value;
      fields.rarityId.dispatchEvent(
        new Event('change', { bubbles: true })
      );
      applied.push('raridade');
    } else {
      warnings.push(
        `Raridade "${data.meta.rarity}" não encontrada.`
      );
    }
  }

  if (data.meta?.faction) {
    setFieldValue(
      fields.faction,
      data.meta.faction,
      'input'
    );
    applied.push('facção');
  }

  if (hero.displayOrder !== null) {
    setFieldValue(fields.displayOrder, hero.displayOrder);
    applied.push('ordem');
  }

  if (hero.active !== null) {
    setFieldValue(fields.enabled, hero.active);
    applied.push('publicação');
  }

  const statsOutcome =
    applyImportedStatsData(
      data,
      {
        announce: false
      }
    );

  if (statsOutcome.applied) {
    applied.push(
      `${statsOutcome.applied} campo(s) de status/arma`
    );
  }

  if (statsOutcome.missing.length) {
    warnings.push(
      `${statsOutcome.missing.length} campo(s) de status/arma sem correspondência.`
    );
  }

  updateAllPreviews();
  saveImportDraft(data);
  refreshImportedStatsButton();

  return { applied, warnings };
}

function injectImportUi() {
  if (document.getElementById('hero-import-open')) return;

  const style = document.createElement('style');
  style.id = 'hero-import-style';

  style.textContent = `
    .hero-import-backdrop{
      position:fixed;inset:0;z-index:10000;display:none;
      align-items:center;justify-content:center;padding:18px;
      background:rgba(2,6,15,.84);backdrop-filter:blur(8px)
    }
    .hero-import-backdrop.is-open{display:flex}
    .hero-import-modal{
      width:min(920px,100%);max-height:calc(100vh - 36px);
      overflow:auto;border:1px solid var(--admin-line);
      border-radius:16px;background:#0b1324;
      box-shadow:0 24px 80px rgba(0,0,0,.52)
    }
    .hero-import-head{
      position:sticky;top:0;z-index:2;display:flex;
      justify-content:space-between;gap:16px;padding:18px 20px;
      border-bottom:1px solid var(--admin-line);background:#0b1324
    }
    .hero-import-head h2{margin:0;font-size:20px}
    .hero-import-head p{margin:6px 0 0;color:var(--admin-muted);font-size:12px}
    .hero-import-body{display:grid;gap:16px;padding:20px}
    .hero-import-card{
      padding:15px;border:1px solid var(--admin-line);
      border-radius:12px;background:#08101e
    }
    .hero-import-card h3{margin:0 0 7px;font-size:14px}
    .hero-import-card p{margin:0;color:var(--admin-muted);font-size:11px}
    .hero-import-textarea{
      width:100%;min-height:220px;margin-top:12px;resize:vertical;
      font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace
    }
    #hero-import-prompt{min-height:170px}
    .hero-import-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px}
    .hero-import-result{display:grid;gap:8px;margin-top:12px}
    .hero-import-summary{
      display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px
    }
    .hero-import-summary div{
      padding:10px;border:1px solid var(--admin-line);
      border-radius:9px;background:#0c1729
    }
    .hero-import-summary small{
      display:block;color:var(--admin-muted);font-size:9px;
      font-weight:800;text-transform:uppercase
    }
    .hero-import-summary strong{display:block;margin-top:4px;font-size:15px}
    .hero-import-note{
      padding:9px 11px;border:1px solid var(--admin-line);
      border-radius:8px;background:#0c1729;color:#c8cfdd;
      font-size:11px;line-height:1.5
    }
    .hero-import-note.ok{border-color:#28583a;color:#8fd3a6}
    .hero-import-note.warn{border-color:#6f5618;color:#ffd76d}
    .hero-import-note.error{border-color:#75353d;color:#ff9da5}
    @media(max-width:700px){
      .hero-import-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
  `;

  document.head.appendChild(style);

  const actions = document.querySelector('.hero-editor-toolbar-actions');
  if (!actions) return;

  const openButton = document.createElement('button');
  openButton.id = 'hero-import-open';
  openButton.type = 'button';
  openButton.className = 'admin-button';
  openButton.textContent = 'Importar dados';
  actions.insertBefore(openButton, actions.firstChild);

  const backdrop = document.createElement('div');
  backdrop.id = 'hero-import-backdrop';
  backdrop.className = 'hero-import-backdrop';

  backdrop.innerHTML = `
    <section class="hero-import-modal" role="dialog" aria-modal="true">
      <header class="hero-import-head">
        <div>
          <h2>Importar dados do herói</h2>
          <p>Cole o JSON produzido pelo ChatGPT. Nada será salvo automaticamente.</p>
        </div>
        <button id="hero-import-close" type="button" class="admin-button">✕</button>
      </header>

      <div class="hero-import-body">
        <section class="hero-import-card">
          <h3>1. Prompt para o ChatGPT</h3>
          <p>Envie os prints do herói e cole este prompt.</p>
          <textarea
            id="hero-import-prompt"
            class="admin-textarea hero-import-textarea"
            readonly
          ></textarea>
          <div class="hero-import-actions">
            <button id="hero-import-copy" type="button" class="admin-button">
              Copiar prompt
            </button>
          </div>
        </section>

        <section class="hero-import-card">
          <h3>2. JSON retornado</h3>
          <p>É aceito JSON puro ou dentro de um bloco de código.</p>
          <textarea
            id="hero-import-json"
            class="admin-textarea hero-import-textarea"
            placeholder="Cole aqui o JSON..."
          ></textarea>

          <div class="hero-import-actions">
            <button id="hero-import-validate" type="button" class="admin-button">
              Validar dados
            </button>
            <button
              id="hero-import-apply"
              type="button"
              class="admin-button primary"
              disabled
            >
              Preencher formulário
            </button>
            <button id="hero-import-clear" type="button" class="admin-button">
              Limpar
            </button>
          </div>

          <div id="hero-import-result" class="hero-import-result"></div>
        </section>

        <div class="hero-import-note">
          Informações gerais, status e arma são preenchidos nesta mesma tela.
          Mídias e habilidades continuam manuais.
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(backdrop);

  const promptArea = document.getElementById('hero-import-prompt');
  const jsonArea = document.getElementById('hero-import-json');
  const resultArea = document.getElementById('hero-import-result');
  const applyButton = document.getElementById('hero-import-apply');

  let validatedData = null;

  promptArea.value = getImportPrompt();

  function closeModal() {
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function openModal() {
    backdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    const stored = loadImportDraft();
    if (stored?.data && !jsonArea.value.trim()) {
      jsonArea.value = JSON.stringify(stored.data, null, 2);
    }

    jsonArea.focus();
  }

  function clearValidation() {
    validatedData = null;
    applyButton.disabled = true;
    resultArea.innerHTML = '';
  }

  function validateJson() {
    try {
      const parsed = JSON.parse(extractJsonText(jsonArea.value));
      validatedData = normalizeImportedData(parsed);

      const classOption = validatedData.hero.class
        ? findClassOption(validatedData.hero.class)
        : null;

      const rarityOption = validatedData.meta?.rarity
        ? findRarityOption(validatedData.meta.rarity)
        : null;

      resultArea.innerHTML = `
        <div class="hero-import-summary">
          <div><small>Informações</small><strong>${countValues(validatedData.hero)}</strong></div>
          <div><small>Status</small><strong>${countValues(validatedData.status)}</strong></div>
          <div><small>Arma resumida</small><strong>${countValues(validatedData.weaponSummary)}</strong></div>
          <div><small>Arma detalhada</small><strong>${countValues(validatedData.weaponDetails)}</strong></div>
          <div><small>Metadados</small><strong>${countValues(validatedData.meta)}</strong></div>
        </div>

        <div class="hero-import-note ${validatedData.hero.name ? 'ok' : 'warn'}">
          ${validatedData.hero.name
            ? `Nome reconhecido: ${escapeHtml(validatedData.hero.name)}.`
            : 'Nome não informado.'}
        </div>

        <div class="hero-import-note ${classOption ? 'ok' : 'warn'}">
          ${validatedData.hero.class
            ? (
                classOption
                  ? `Classe encontrada: ${escapeHtml(classOption.textContent.trim())}.`
                  : `Classe não encontrada: ${escapeHtml(validatedData.hero.class)}.`
              )
            : 'Classe não informada.'}
        </div>

        <div class="hero-import-note ${
          validatedData.meta?.rarity
            ? (rarityOption ? 'ok' : 'warn')
            : 'warn'
        }">
          ${
            validatedData.meta?.rarity
              ? (
                  rarityOption
                    ? `Raridade encontrada: ${escapeHtml(rarityOption.textContent.trim())}.`
                    : `Raridade não encontrada: ${escapeHtml(validatedData.meta.rarity)}.`
                )
              : 'Raridade não informada.'
          }
        </div>

        <div class="hero-import-note ${
          validatedData.meta?.faction ? 'ok' : 'warn'
        }">
          ${
            validatedData.meta?.faction
              ? `Facção reconhecida: ${escapeHtml(validatedData.meta.faction)}.`
              : 'Facção não informada.'
          }
        </div>
      `;

      applyButton.disabled = false;
      showMessage('JSON validado. Revise antes de preencher.', 'ok');
      return validatedData;
    } catch (error) {
      clearValidation();
      resultArea.innerHTML = `
        <div class="hero-import-note error">
          ${escapeHtml(error.message || 'JSON inválido.')}
        </div>
      `;
      showMessage(error.message || 'JSON inválido.', 'error');
      return null;
    }
  }

  openButton.addEventListener('click', openModal);
  document.getElementById('hero-import-close').addEventListener('click', closeModal);

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeModal();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && backdrop.classList.contains('is-open')) {
      closeModal();
    }
  });

  document.getElementById('hero-import-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getImportPrompt());
    } catch {
      promptArea.select();
      document.execCommand('copy');
    }
    showMessage('Prompt copiado.', 'ok');
  });

  document.getElementById('hero-import-validate').addEventListener('click', validateJson);

  document.getElementById('hero-import-apply').addEventListener('click', () => {
    const data = validatedData || validateJson();
    if (!data) return;

    const outcome = applyImportedData(data);
    let text = outcome.applied.length
      ? `${outcome.applied.length} campo(s) preenchido(s): ${outcome.applied.join(', ')}.`
      : 'Nenhum campo geral pôde ser preenchido.';

    if (outcome.warnings.length) {
      text += ` ${outcome.warnings.join(' ')}`;
    }

    showMessage(text, outcome.applied.length ? 'ok' : 'error');
    closeModal();
  });

  document.getElementById('hero-import-clear').addEventListener('click', () => {
    jsonArea.value = '';
    clearValidation();
    jsonArea.focus();
  });

  jsonArea.addEventListener('input', clearValidation);
}

/* =========================================================
   CARREGAMENTO DO HERÓI
========================================================= */

function populateHero(hero) {
  currentHero = hero;

  fields.name.value = hero.name ?? '';
  fields.slug.value = hero.slug ?? '';
  fields.classId.value = hero.class_id ?? '';
  fields.rarityId.value = hero.rarity_id ?? '';
  fields.faction.value = hero.faction ?? '';
  fields.displayOrder.value = String(hero.display_order ?? 0);
  fields.description.value = hero.description ?? '';
  fields.enabled.checked = hero.enabled !== false;

  mainEditor.setSource(getPublicUrl(hero.image_path), {
    scale: hero.image_scale ?? 1,
    offsetX: hero.image_offset_x ?? 0,
    offsetY: hero.image_offset_y ?? 0
  });

  cardEditor.setSource(getPublicUrl(hero.card_image_path), {
    scale: hero.card_image_scale ?? 1,
    offsetX: hero.card_image_offset_x ?? 0,
    offsetY: hero.card_image_offset_y ?? 0
  });

  gifEditor.setSource(getPublicUrl(hero.gif_path), {
    scale: hero.gif_scale ?? 1,
    offsetX: hero.gif_offset_x ?? 0,
    offsetY: hero.gif_offset_y ?? 0
  });

  const editorTitle = document.getElementById('editor-title');
  if (editorTitle) editorTitle.textContent = `Editar ${hero.name}`;
  if (saveButton) saveButton.textContent = 'Atualizar herói';

  updateAllPreviews();
}

async function loadHero() {
  if (!heroId) return;

  showMessage('Carregando herói...');

  const { data, error } = await supabase
    .from('heroes')
    .select(`
      id, name, slug, description, class_id, rarity_id, faction, enabled, display_order,
      image_path, image_scale, image_offset_x, image_offset_y,
      card_image_path, card_image_scale, card_image_offset_x, card_image_offset_y,
      gif_path, gif_scale, gif_offset_x, gif_offset_y
    `)
    .eq('id', heroId)
    .single();

  if (error) throw error;

  populateHero(data);
  await loadIntegratedStats(data.id);
  refreshImportedStatsButton();
  showMessage('');
}

/* =========================================================
   VALIDAÇÃO, UPLOAD E SALVAMENTO
========================================================= */

function validateForm() {
  const name = fields.name.value.trim();

  if (!name) throw new Error('Informe o nome do herói.');

  const slug = slugify(name);

  if (!slug) throw new Error('Não foi possível gerar o identificador.');

  fields.slug.value = slug;
  return slug;
}

async function validateSlugAvailability(slug) {
  let query = supabase
    .from('heroes')
    .select('id')
    .eq('slug', slug)
    .limit(1);

  if (heroId) query = query.neq('id', heroId);

  const { data, error } = await query;

  if (error) throw error;

  return data?.[0] || null;
}

/* =========================================================
   ASSISTENTE DE ATUALIZAÇÃO INTELIGENTE
========================================================= */

const UPDATE_HISTORY_KEY = 'echo-arena-hero-version-history';

function readVersionHistory() {
  try { return JSON.parse(localStorage.getItem(UPDATE_HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

function writeVersionHistory(history) {
  localStorage.setItem(UPDATE_HISTORY_KEY, JSON.stringify(history));
}

function valuesEqual(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  if (b === null || b === undefined || b === '') return false;
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber === bNumber;
  return String(a).trim() === String(b).trim();
}

function displayDiffValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Ativo' : 'Inativo';
  return String(value);
}

function classifyDifference(before, after, kind = 'text') {
  if (valuesEqual(before, after)) return 'same';
  if (kind !== 'number') return 'text';
  return Number(after) > Number(before) ? 'increase' : 'decrease';
}

function isLargeNumericChange(before, after) {
  const oldNumber = Number(before);
  const newNumber = Number(after);
  if (!Number.isFinite(oldNumber) || !Number.isFinite(newNumber) || oldNumber === 0) return false;
  return Math.abs(newNumber - oldNumber) / Math.abs(oldNumber) > .8;
}

function createDiff({ key, label, group, before, after, kind = 'text', apply, selected = true }) {
  const change = classifyDifference(before, after, kind);
  return {
    key, label, group, before, after, kind, change, apply,
    changed: change !== 'same',
    selected: change !== 'same' && selected,
    risky: kind === 'number' && change !== 'same' && isLargeNumericChange(before, after)
  };
}

async function loadExistingHeroBundle(targetId) {
  const [heroResult, heroStatsResult, weaponStatsResult] = await Promise.all([
    supabase.from('heroes').select(`
      id, name, slug, description, class_id, rarity_id, faction, enabled, display_order,
      image_path, image_scale, image_offset_x, image_offset_y,
      card_image_path, card_image_scale, card_image_offset_x, card_image_offset_y,
      gif_path, gif_scale, gif_offset_x, gif_offset_y
    `).eq('id', targetId).single(),
    supabase.from('hero_base_stats').select('stat_key,value').eq('hero_id', targetId),
    supabase.from('hero_weapon_stats').select('stat_key,value,weapon_name').eq('hero_id', targetId)
  ]);
  if (heroResult.error) throw heroResult.error;
  if (heroStatsResult.error) throw heroStatsResult.error;
  if (weaponStatsResult.error) throw weaponStatsResult.error;
  return {
    hero: heroResult.data,
    heroStats: Object.fromEntries((heroStatsResult.data || []).map(row => [row.stat_key, row.value])),
    weaponStats: Object.fromEntries((weaponStatsResult.data || []).map(row => [row.stat_key, row.value])),
    weaponName: weaponStatsResult.data?.[0]?.weapon_name || null
  };
}

function classNameForId(id) {
  const option = [...(fields.classId?.options || [])].find(
    item => item.value === String(id || '')
  );

  return option?.textContent.trim() || 'Sem classe';
}

function rarityNameForId(id) {
  const option = [...(fields.rarityId?.options || [])].find(
    item => item.value === String(id || '')
  );

  return option?.textContent.trim() || 'Sem raridade';
}

function formatHeroDiffValue(item, value) {
  if (item.key === 'class_id') {
    return classNameForId(value);
  }

  if (item.key === 'rarity_id') {
    return rarityNameForId(value);
  }

  return displayDiffValue(value);
}

function buildUpdateDiffs(bundle) {
  const hero = bundle.hero;
  const imported = loadImportDraft()?.data?.hero || {};
  const importedValue = (key, formValue, currentValue) =>
    imported[key] === null || imported[key] === undefined ? currentValue : formValue;
  const diffs = [
    createDiff({ key:'name', label:'Nome', group:'Geral', before:hero.name, after:importedValue('name',fields.name.value.trim(),hero.name), apply:{ type:'hero', column:'name' } }),
    createDiff({ key:'class_id', label:'Classe', group:'Geral', before:hero.class_id, after:importedValue('class',fields.classId.value || null,hero.class_id), apply:{ type:'hero', column:'class_id' } }),
    createDiff({ key:'rarity_id', label:'Raridade', group:'Geral', before:hero.rarity_id, after:loadImportDraft()?.data?.meta?.rarity == null ? hero.rarity_id : (fields.rarityId.value || null), apply:{ type:'hero', column:'rarity_id' } }),
    createDiff({ key:'faction', label:'Facção', group:'Geral', before:hero.faction, after:loadImportDraft()?.data?.meta?.faction == null ? hero.faction : (fields.faction.value.trim() || null), apply:{ type:'hero', column:'faction' } }),
    createDiff({ key:'description', label:'Descrição', group:'Geral', before:hero.description, after:importedValue('description',fields.description.value.trim() || null,hero.description), apply:{ type:'hero', column:'description' } }),
    createDiff({ key:'enabled', label:'Publicação', group:'Geral', before:hero.enabled, after:importedValue('active',fields.enabled.checked,hero.enabled), apply:{ type:'hero', column:'enabled' } }),
    createDiff({ key:'display_order', label:'Ordem de exibição', group:'Geral', before:hero.display_order, after:importedValue('displayOrder',toNumber(fields.displayOrder.value,0),hero.display_order), kind:'number', apply:{ type:'hero', column:'display_order' } })
  ];

  for (const group of ['hero', 'weapon']) {
    const existing = group === 'hero' ? bundle.heroStats : bundle.weaponStats;
    for (const row of collectIntegratedStatFields(group)) {
      const definition = statDefinitions.find(item => item.key === row.stat_key) || {};
      diffs.push(createDiff({
        key:`${group}.${row.stat_key}`, label:definition.name || row.stat_key,
        group:group === 'hero' ? 'Status' : 'Arma', before:existing[row.stat_key], after:row.value,
        kind:'number', apply:{ type:'stat', table:group === 'hero' ? 'hero_base_stats' : 'hero_weapon_stats', statKey:row.stat_key, weaponName:integratedStats.weaponName?.value.trim() || bundle.weaponName || null }
      }));
    }
  }

  const media = [
    ['image','Imagem principal',fields.imageFile.files?.[0],hero.image_path],
    ['card','Imagem do card',fields.cardFile.files?.[0],hero.card_image_path],
    ['gif','GIF',fields.gifFile.files?.[0],hero.gif_path]
  ];
  for (const [key,label,file,before] of media) {
    diffs.push(createDiff({ key:`media.${key}`, label, group:'Mídia', before:before ? 'Cadastrada' : 'Não cadastrada', after:file?.name || (before ? 'Cadastrada' : 'Não cadastrada'), apply:{ type:'media', media:key }, selected:Boolean(file) }));
  }
  return diffs;
}

function diffSummary(diffs) {
  const changed = diffs.filter(item => item.changed);
  return {
    changed: changed.length,
    increases: changed.filter(item => item.change === 'increase').length,
    decreases: changed.filter(item => item.change === 'decrease').length,
    texts: changed.filter(item => item.change === 'text').length,
    same: diffs.length - changed.length
  };
}

function renderVersionHistory(targetId) {
  const history = readVersionHistory()[targetId] || [];
  if (!history.length) return '';
  return `<section class="update-group"><div class="update-group-head">HISTÓRICO <span>${history.length} backup(s) neste navegador</span></div>${history.slice().reverse().slice(0,5).map(item => `
    <div class="update-diff"><span></span><div class="update-diff-label"><strong>v${item.version}</strong><small>${escapeHtml(new Date(item.createdAt).toLocaleString('pt-BR'))}</small></div><div class="update-value">${escapeHtml(item.summary || 'Backup automático')}</div><span></span><button type="button" class="admin-button" data-restore-version="${item.version}">Restaurar versão</button></div>
  `).join('')}</section>`;
}

function renderUpdateAssistant() {
  if (!pendingUpdate) return;
  const { bundle, diffs } = pendingUpdate;
  const summary = diffSummary(diffs);
  const summaryElement = document.getElementById('update-assistant-summary');
  const body = document.getElementById('update-assistant-body');
  const selectedCount = diffs.filter(item => item.changed && item.selected).length;
  summaryElement.innerHTML = [
    [summary.changed,'alterações'],[summary.increases,'aumentos'],[summary.decreases,'reduções'],[summary.texts,'textos modificados'],[summary.same,'campos iguais']
  ].map(([value,label]) => `<div class="update-summary-item"><strong>${value}</strong><span>${label}</span></div>`).join('');

  const newImage = fields.imageFile.files?.[0] ? URL.createObjectURL(fields.imageFile.files[0]) : getPublicUrl(bundle.hero.image_path);
  const identity = `<div class="update-identity-grid">
    <article class="update-identity-card">${bundle.hero.image_path ? `<img src="${escapeHtml(getPublicUrl(bundle.hero.image_path))}" alt="">` : '<div class="update-avatar-placeholder">◇</div>'}<div><small>HERÓI CADASTRADO</small><h3>${escapeHtml(bundle.hero.name)}</h3><p>${escapeHtml(classNameForId(bundle.hero.class_id))} · versão ${pendingUpdate.nextVersion - 1}</p></div></article>
    <article class="update-identity-card">${newImage ? `<img src="${escapeHtml(newImage)}" alt="">` : '<div class="update-avatar-placeholder">◇</div>'}<div><small>NOVO JSON</small><h3>${escapeHtml(fields.name.value.trim())}</h3><p>${escapeHtml(classNameForId(fields.classId.value))} · importado agora</p></div></article>
  </div>`;

  const groups = ['Geral','Status','Arma','Mídia','Habilidades'];
  const groupHtml = groups.map(group => {
    const items = diffs.filter(item => item.group === group);
    if (!items.length) return `<section class="update-group"><div class="update-group-head">${group.toUpperCase()} <span>Nenhuma alteração</span></div></section>`;
    return `<section class="update-group"><div class="update-group-head">${group.toUpperCase()} <span>${items.filter(item=>item.changed).length ? `${items.filter(item=>item.changed).length} alteração(ões)` : 'Sem alterações'}</span></div>${items.map(item => `
      <div class="update-diff ${item.change} ${item.changed ? '' : 'is-same'}">
        <input type="checkbox" data-diff-key="${escapeHtml(item.key)}" ${item.selected ? 'checked' : ''} ${item.changed ? '' : 'disabled'} aria-label="Atualizar ${escapeHtml(item.label)}">
        <div class="update-diff-label"><strong>${escapeHtml(item.label)}</strong><small>${item.changed ? (item.change === 'increase' ? '▲ Aumento' : item.change === 'decrease' ? '▼ Redução' : '⚠ Modificado') : '✔ Sem alteração'}</small></div>
        <div class="update-value">${escapeHtml(formatHeroDiffValue(item, item.before))}</div><div class="update-arrow">→</div>
        <div class="update-value">${escapeHtml(formatHeroDiffValue(item, item.after))}</div>
        ${item.risky ? '<div class="update-risk">⚠ Alteração muito grande — diferença superior a 80%. Confirme com atenção; pode ser um erro de OCR.</div>' : ''}
      </div>`).join('')}</section>`;
  }).join('');
  body.innerHTML = identity + (summary.changed ? groupHtml : '<div class="update-empty"><strong>Nenhuma alteração encontrada</strong><br>Os dados importados são idênticos aos já cadastrados. Nada será atualizado.</div>') + renderVersionHistory(bundle.hero.id);
  document.getElementById('update-final-stats').innerHTML = `✔ ${selectedCount} campos selecionados<br>✔ ${summary.same + summary.changed - selectedCount} preservados · ✔ 0 apagados · ✔ backup será criado`;
  const selectedButton = document.getElementById('update-selected');
  selectedButton.disabled = selectedCount === 0;
  document.getElementById('update-all').disabled = summary.changed === 0;

  body.querySelectorAll('[data-diff-key]').forEach(input => input.addEventListener('change', () => {
    const diff = diffs.find(item => item.key === input.dataset.diffKey);
    if (diff) diff.selected = input.checked;
    renderUpdateAssistant();
  }));
  body.querySelectorAll('[data-restore-version]').forEach(button => button.addEventListener('click', () => restoreHeroVersion(Number(button.dataset.restoreVersion))));
}

function closeUpdateAssistant({ discard = false } = {}) {
  document.getElementById('update-assistant-backdrop')?.classList.remove('is-open');
  document.body.classList.remove('update-assistant-open');
  if (discard) sessionStorage.removeItem(IMPORT_KEY);
  pendingUpdate = null;
}

async function openUpdateAssistant(existing) {
  const bundle = await loadExistingHeroBundle(existing.id);
  const history = readVersionHistory()[existing.id] || [];
  pendingUpdate = { bundle, diffs:buildUpdateDiffs(bundle), nextVersion:history.length + 2 };
  renderUpdateAssistant();
  document.getElementById('update-assistant-backdrop').classList.add('is-open');
  document.getElementById('update-assistant-backdrop').setAttribute('aria-hidden','false');
  document.body.classList.add('update-assistant-open');
}

function createVersionBackup(bundle, diffs) {
  const history = readVersionHistory();
  const list = history[bundle.hero.id] || [];
  list.push({ version:list.length + 1, createdAt:new Date().toISOString(), summary:`${diffs.filter(item=>item.changed && item.selected).length} campo(s) alterado(s)`, snapshot:bundle });
  history[bundle.hero.id] = list.slice(-25);
  writeVersionHistory(history);
  return list.length;
}

async function applySelectedUpdate(selectAll = false) {
  if (!pendingUpdate || isSaving) return;
  const chosen = pendingUpdate.diffs.filter(item => item.changed && (selectAll || item.selected));
  if (!chosen.length) return;
  const risky = chosen.filter(item => item.risky);
  if (risky.length && !confirm(`${risky.length} alteração(ões) variam mais de 80%. Deseja continuar?`)) return;
  isSaving = true;
  try {
    const { bundle } = pendingUpdate;
    createVersionBackup(bundle, chosen);
    const mediaChosen = new Set(chosen.filter(item=>item.apply.type==='media').map(item=>item.apply.media));
    const upload = await uploadSelectedMediaSelective(bundle.hero.slug, mediaChosen);
    const heroPatch = {};
    for (const item of chosen.filter(item=>item.apply.type==='hero')) {
      if (item.after !== null && item.after !== undefined) heroPatch[item.apply.column] = item.after;
    }
    if (upload.imagePath) heroPatch.image_path = upload.imagePath;
    if (upload.cardImagePath) heroPatch.card_image_path = upload.cardImagePath;
    if (upload.gifPath) heroPatch.gif_path = upload.gifPath;
    if (Object.keys(heroPatch).length) {
      const { error } = await supabase.from('heroes').update(heroPatch).eq('id', bundle.hero.id);
      if (error) throw error;
    }
    for (const item of chosen.filter(item=>item.apply.type==='stat')) {
      const payload = { hero_id:bundle.hero.id, stat_key:item.apply.statKey, value:item.after };
      if (item.apply.table === 'hero_weapon_stats') payload.weapon_name = item.apply.weaponName;
      const { error } = await supabase.from(item.apply.table).upsert(payload,{ onConflict:'hero_id,stat_key' });
      if (error) throw error;
    }
    const modified = chosen.length;
    const preserved = pendingUpdate.diffs.length - modified;
    closeUpdateAssistant();
    showMessage(`Atualização concluída: ${modified} campos modificados, ${preserved} preservados, 0 apagados e backup criado.`, 'ok');
    announceSaveSuccess({
      id: bundle.hero.id,
      name: fields.name.value.trim() || bundle.hero.name,
      updated: true,
      details: [
        `✓ ${modified} campos modificados`,
        `✓ ${preserved} campos preservados`,
        '✓ Nenhum dado apagado',
        '✓ Backup criado'
      ]
    });
  } catch (error) {
    console.error('Erro na atualização inteligente:', error);
    showMessage(error.message || 'Não foi possível atualizar o herói.', 'error');
  } finally { isSaving = false; }
}

async function uploadSelectedMediaSelective(slug, selected) {
  const imageTypes = ['image/png','image/jpeg','image/webp','image/gif'];
  const [imagePath, cardImagePath, gifPath] = await Promise.all([
    selected.has('image') ? uploadFile({file:fields.imageFile.files?.[0],heroSlug:slug,mediaType:'Main',allowedTypes:imageTypes}) : null,
    selected.has('card') ? uploadFile({file:fields.cardFile.files?.[0],heroSlug:slug,mediaType:'Card',allowedTypes:imageTypes}) : null,
    selected.has('gif') ? uploadFile({file:fields.gifFile.files?.[0],heroSlug:slug,mediaType:'GIF',allowedTypes:['image/gif']}) : null
  ]);
  return { imagePath, cardImagePath, gifPath };
}

async function restoreHeroVersion(version) {
  if (!pendingUpdate || !confirm(`Restaurar a versão v${version}? Um backup do estado atual será criado antes.`)) return;
  const id = pendingUpdate.bundle.hero.id;
  const record = (readVersionHistory()[id] || []).find(item => item.version === version);
  if (!record?.snapshot) return;
  try {
    createVersionBackup(pendingUpdate.bundle, []);
    const snapshot = record.snapshot;
    const { id:ignored, ...heroPayload } = snapshot.hero;
    const { error } = await supabase.from('heroes').update(heroPayload).eq('id', id);
    if (error) throw error;
    const restoreStats = async (table, stats, extra={}) => {
      const { error:deleteError } = await supabase.from(table).delete().eq('hero_id',id);
      if (deleteError) throw deleteError;
      const rows = Object.entries(stats || {}).map(([stat_key,value]) => ({hero_id:id,stat_key,value,...extra}));
      if (rows.length) { const { error:insertError } = await supabase.from(table).insert(rows); if (insertError) throw insertError; }
    };
    await restoreStats('hero_base_stats',snapshot.heroStats);
    await restoreStats('hero_weapon_stats',snapshot.weaponStats,{weapon_name:snapshot.weaponName});
    closeUpdateAssistant();
    showMessage(`Versão v${version} restaurada com sucesso.`, 'ok');
    setTimeout(()=>location.reload(),700);
  } catch(error) { showMessage(error.message || 'Não foi possível restaurar a versão.','error'); }
}

function bindUpdateAssistant() {
  document.getElementById('update-cancel')?.addEventListener('click',()=>closeUpdateAssistant());
  document.getElementById('update-discard')?.addEventListener('click',()=>{ closeUpdateAssistant({discard:true}); showMessage('Importação descartada.',''); });
  document.getElementById('update-selected')?.addEventListener('click',()=>applySelectedUpdate(false));
  document.getElementById('update-all')?.addEventListener('click',()=>applySelectedUpdate(true));
}

async function uploadFile({ file, heroSlug, mediaType, allowedTypes }) {
  if (!file) return null;

  validateFile(file, allowedTypes);

  const path =
    `Heros/${heroSlug}/${mediaType}/` +
    `${createUniqueId()}-${sanitizeFilename(file.name)}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });

  if (error) throw error;
  return path;
}

async function uploadSelectedMedia(slug) {
  const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  const [imagePath, cardImagePath, gifPath] = await Promise.all([
    uploadFile({
      file: fields.imageFile.files?.[0],
      heroSlug: slug,
      mediaType: 'Main',
      allowedTypes: imageTypes
    }),
    uploadFile({
      file: fields.cardFile.files?.[0],
      heroSlug: slug,
      mediaType: 'Card',
      allowedTypes: imageTypes
    }),
    uploadFile({
      file: fields.gifFile.files?.[0],
      heroSlug: slug,
      mediaType: 'GIF',
      allowedTypes: ['image/gif']
    })
  ]);

  return { imagePath, cardImagePath, gifPath };
}

function collectPayload(slug, uploadedMedia) {
  const mainState = mainEditor.getState();
  const cardState = cardEditor.getState();
  const gifState = gifEditor.getState();

  return {
    name: fields.name.value.trim(),
    slug,
    description: fields.description.value.trim() || null,
    class_id: fields.classId.value || null,
    rarity_id: fields.rarityId.value || null,
    faction: fields.faction.value.trim() || null,
    enabled: fields.enabled.checked,
    display_order: toNumber(fields.displayOrder.value, 0),

    image_path: uploadedMedia.imagePath || currentHero?.image_path || null,
    image_fit: 'contain',
    image_position: '50% 50%',
    image_scale: mainState.scale,
    image_offset_x: mainState.offsetX,
    image_offset_y: mainState.offsetY,

    card_image_path:
      uploadedMedia.cardImagePath || currentHero?.card_image_path || null,
    card_image_scale: cardState.scale,
    card_image_offset_x: cardState.offsetX,
    card_image_offset_y: cardState.offsetY,

    gif_path: uploadedMedia.gifPath || currentHero?.gif_path || null,
    gif_scale: gifState.scale,
    gif_offset_x: gifState.offsetX,
    gif_offset_y: gifState.offsetY
  };
}

async function createHero(payload) {
  const { data, error } = await supabase
    .from('heroes')
    .insert(payload)
    .select('id,name,slug')
    .single();

  if (error) throw error;
  return data;
}

async function updateHero(payload) {
  const { data, error } = await supabase
    .from('heroes')
    .update(payload)
    .eq('id', heroId)
    .select('id,name,slug')
    .single();

  if (error) throw error;
  return data;
}

async function saveHero(event) {
  event.preventDefault();

  if (isSaving) return;
  isSaving = true;

  const originalButtonText = saveButton?.textContent || 'Salvar herói';

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Salvando...';
  }

  try {
    const slug = validateForm();

    const existingHero = await validateSlugAvailability(slug);

    if (existingHero) {
      await openUpdateAssistant(existingHero);
      showMessage('Herói existente encontrado. Revise as alterações no assistente.');
      return;
    }

    showMessage('Enviando mídias...');
    const uploadedMedia = await uploadSelectedMedia(slug);

    showMessage(heroId ? 'Atualizando herói...' : 'Criando herói...');
    const payload = collectPayload(slug, uploadedMedia);

    const savedHero = heroId
      ? await updateHero(payload)
      : await createHero(payload);

    showMessage('Salvando status e arma...');
    await saveIntegratedStats(savedHero.id);

    updateImportDraftAfterSave(savedHero, slug);

    showMessage(
      heroId
        ? 'Herói, status e arma atualizados com sucesso.'
        : 'Herói, status e arma criados com sucesso.',
      'ok'
    );

    announceSaveSuccess({
      id: savedHero.id,
      name: savedHero.name || fields.name.value.trim(),
      updated: Boolean(heroId),
      details: [
        '✓ Informações gerais salvas',
        '✓ Status confirmados',
        '✓ Dados da arma confirmados',
        '✓ Operação concluída'
      ]
    });

    if (!heroId) {
      return;
    }

    currentHero = { ...currentHero, ...payload, id: savedHero.id };

    fields.imageFile.value = '';
    fields.cardFile.value = '';
    fields.gifFile.value = '';

    updateAllPreviews();
  } catch (error) {
    console.error('Erro ao salvar herói:', error);
    showMessage(error.message || 'Não foi possível salvar o herói.', 'error');
  } finally {
    isSaving = false;

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = heroId ? 'Atualizar herói' : originalButtonText;
    }
  }
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function initialize() {
  try {
    showMessage('Preparando editor...');

    createAllMediaEditors();
    bindAutomaticSlug();
    bindGeneralPreview();
    bindIntegratedStatsControls();
    bindUpdateAssistant();
    ensureSaveSuccessUi();

    form?.addEventListener('submit', saveHero);

    await Promise.all([
      loadHeroClasses(),
      loadHeroRarities(),
      loadStatDefinitions()
    ]);

    if (heroId) {
      await loadHero();
    } else {
      await loadNextDisplayOrder();
      fields.enabled.checked = true;

      mainEditor.reset();
      cardEditor.reset();
      gifEditor.reset();
      renderIntegratedStatsFields();

      showMessage('');
    }

    injectImportUi();
    refreshImportedStatsButton();
    updateAllPreviews();
    repairDocumentEncoding();
    bindEncodingRepairObserver();
    restorePendingSaveSuccess();

    window.addEventListener('resize', () => {
      mainEditor.resize();
      cardEditor.resize();
      gifEditor.resize();
    });
  } catch (error) {
    console.error('Erro ao iniciar editor:', error);
    showMessage(error.message || 'Não foi possível carregar o editor.', 'error');
  }
}

await initialize();

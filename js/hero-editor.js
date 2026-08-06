import { supabase } from '../../js/supabase.js';

/* =========================================================
   MODELO DE ENQUADRAMENTO

   O recorte usa o MESMO modelo do site:
     - a imagem preenche 100% do quadro
     - object-fit define cover ou contain
     - o deslocamento é PERCENTUAL do quadro, não em pixels

   Assim o mesmo valor produz o mesmo resultado em qualquer
   tamanho de tela — editor, card pequeno ou spotlight.
========================================================= */

const STORAGE_BUCKET = 'game-media';
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const params = new URLSearchParams(location.search);
const heroId = params.get('id');

const form = document.getElementById('hero-form');
const message = document.getElementById('message');
const saveButton = document.getElementById('save-hero-button');

const fields = {
  name: document.getElementById('name'),
  slug: document.getElementById('slug'),
  classId: document.getElementById('class-id'),
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

let currentHero = null;
let isSaving = false;

/* =========================================================
   UTILITÁRIOS
========================================================= */

function showMessage(text = '', type = '') {
  if (!message) return;
  message.textContent = text;
  message.className = type;
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

/* =========================================================
   EDITOR DE RECORTE
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
    offsetX: 0,   /* percentual do quadro */
    offsetY: 0,   /* percentual do quadro */

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
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = '';
    }
  }

  /* Mesmo modelo do site: a imagem ocupa o quadro inteiro e
     o object-fit resolve o redimensionamento. Sem cálculo
     manual de tamanho — é isso que garante fidelidade. */
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

    const x = -50 + state.offsetX;
    const y = -50 + state.offsetY;

    image.style.transform = `translate(${x}%, ${y}%) scale(${state.scale})`;

    if (zoom) zoom.value = String(state.scale);
    if (zoomValue) zoomValue.textContent = `${Math.round(state.scale * 100)}%`;

    notifyChange();
  }

  function setSource(source, { scale = 1, offsetX = 0, offsetY = 0, isObjectUrl = false } = {}) {
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

    zoom?.addEventListener('input', (event) => {
      state.scale = toNumber(event.target.value, 1);
      updateTransform();
    });

    centerButton?.addEventListener('click', center);
    resetButton?.addEventListener('click', reset);

    canvas.addEventListener('pointerdown', (event) => {
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

    canvas.addEventListener('pointermove', (event) => {
      if (!state.dragging || event.pointerId !== state.pointerId) return;

      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;

      /* Pixels arrastados viram percentual do quadro. */
      const movementX = ((event.clientX - state.pointerStartX) / width) * 100;
      const movementY = ((event.clientY - state.pointerStartY) / height) * 100;

      state.offsetX = state.originalOffsetX + movementX;
      state.offsetY = state.originalOffsetY + movementY;

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
    name,
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

/* =========================================================
   INSTÂNCIAS
   O object-fit de cada editor espelha o destino real:
     principal → spotlight (contain)
     card      → card de herói (cover)
     gif       → animação (cover)
========================================================= */

let mainEditor;
let cardEditor;
let gifEditor;

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
   PRÉVIA
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

/* =========================================================
   EVENTOS DOS CAMPOS
========================================================= */

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
      <option value="${heroClass.id}">${heroClass.name}</option>
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
   CARREGAMENTO DO HERÓI
========================================================= */

function populateHero(hero) {
  currentHero = hero;

  fields.name.value = hero.name ?? '';
  fields.slug.value = hero.slug ?? '';
  fields.classId.value = hero.class_id ?? '';
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

  const statsUrl = `./hero-stats.html?hero=${hero.id}`;
  const statsLink = document.getElementById('open-hero-stats');
  const weaponLink = document.getElementById('open-weapon-stats');

  if (statsLink) statsLink.href = statsUrl;
  if (weaponLink) weaponLink.href = `${statsUrl}&section=weapon`;

  updateAllPreviews();
}

async function loadHero() {
  if (!heroId) return;

  showMessage('Carregando herói...');

  const { data, error } = await supabase
    .from('heroes')
    .select(`
      id, name, slug, description, class_id, enabled, display_order,
      image_path, image_scale, image_offset_x, image_offset_y,
      card_image_path, card_image_scale, card_image_offset_x, card_image_offset_y,
      gif_path, gif_scale, gif_offset_x, gif_offset_y
    `)
    .eq('id', heroId)
    .single();

  if (error) throw error;

  populateHero(data);
  showMessage('');
}

/* =========================================================
   VALIDAÇÕES
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

  if (data?.length) {
    throw new Error(`Já existe outro herói usando o identificador "${slug}".`);
  }
}

/* =========================================================
   UPLOAD
========================================================= */

async function uploadFile({ file, heroSlug, mediaType, allowedTypes }) {
  if (!file) return null;

  validateFile(file, allowedTypes);

  const path =
    `Heros/${heroSlug}/${mediaType}/` +
    `${createUniqueId()}-` +
    sanitizeFilename(file.name);

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

/* =========================================================
   PAYLOAD
========================================================= */

function collectPayload(slug, uploadedMedia) {
  const mainState = mainEditor.getState();
  const cardState = cardEditor.getState();
  const gifState = gifEditor.getState();

  return {
    name: fields.name.value.trim(),
    slug,
    description: fields.description.value.trim() || null,
    class_id: fields.classId.value || null,
    enabled: fields.enabled.checked,
    display_order: toNumber(fields.displayOrder.value, 0),

    image_path:
      uploadedMedia.imagePath || currentHero?.image_path || null,
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

    gif_path:
      uploadedMedia.gifPath || currentHero?.gif_path || null,
    gif_scale: gifState.scale,
    gif_offset_x: gifState.offsetX,
    gif_offset_y: gifState.offsetY
  };
}

/* =========================================================
   CRIAÇÃO E ATUALIZAÇÃO
========================================================= */

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

/* =========================================================
   SALVAMENTO
========================================================= */

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

    await validateSlugAvailability(slug);

    showMessage('Enviando mídias...');
    const uploadedMedia = await uploadSelectedMedia(slug);

    showMessage(heroId ? 'Atualizando herói...' : 'Criando herói...');
    const payload = collectPayload(slug, uploadedMedia);

    const savedHero = heroId
      ? await updateHero(payload)
      : await createHero(payload);

    showMessage(
      heroId
        ? 'Herói atualizado com sucesso.'
        : 'Herói criado com sucesso.',
      'ok'
    );

    if (!heroId) {
      setTimeout(() => {
        location.href = `./hero-editor.html?id=${savedHero.id}&tab=media`;
      }, 700);
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

    form?.addEventListener('submit', saveHero);

    await loadHeroClasses();

    if (heroId) {
      await loadHero();
    } else {
      await loadNextDisplayOrder();
      fields.enabled.checked = true;

      mainEditor.reset();
      cardEditor.reset();
      gifEditor.reset();

      showMessage('');
    }

    updateAllPreviews();

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

import { supabase } from '../../js/supabase.js';
import { SITE_CONTENT_PAGES, getContentPage } from '../../js/site-content-schema.js?v=5';
import { uploadMedia } from '../../js/media-storage.js';

const elements = {
  pageSelect: document.getElementById('page-select'),
  pageName: document.getElementById('page-name'),
  pageDescription: document.getElementById('page-description'),
  published: document.getElementById('page-published'),
  openPage: document.getElementById('open-page'),
  fields: document.getElementById('content-fields'),
  message: document.getElementById('content-message'),
  warning: document.getElementById('setup-warning'),
  dirty: document.getElementById('dirty-badge'),
  save: document.getElementById('save-content'),
  reload: document.getElementById('reload-content'),
  refresh: document.getElementById('refresh-preview'),
  preview: document.getElementById('page-preview'),
  tabs: document.getElementById('content-editor-tabs'),
  workspace: document.getElementById('content-workspace'),
  imageTemplate: document.getElementById('image-field-template')
};

const state = {
  page: SITE_CONTENT_PAGES[0],
  row: null,
  content: {},
  original: {},
  published: true,
  originalPublished: true,
  saving: false,
  uploading: 0,
  heroes: [],
  activeTab: 'information',
  activeGroups: {}
};

const editorTabs = [
  { key: 'information', label: 'Informações', description: 'SEO, títulos, descrições e filtros.' },
  { key: 'media', label: 'Mídia', description: 'Imagens, cenários e enquadramentos.' },
  { key: 'content', label: 'Conteúdo', description: 'Textos, ações, cards e mensagens.' },
  { key: 'visibility', label: 'Visibilidade', description: 'Controle das seções publicadas.' },
  { key: 'preview', label: 'Prévia', description: 'Visualização completa em tempo real.' }
];

function escapeHtml(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function setMessage(text = '', type = '') {
  elements.message.textContent = text;
  elements.message.className = `content-message${type ? ` ${type}` : ''}`;
}

function isDirty() {
  return JSON.stringify(state.content) !== JSON.stringify(state.original)
    || state.published !== state.originalPublished;
}

function updateDirty() {
  elements.dirty.hidden = !isDirty();
}

function setValue(key, value) {
  if (value === '' || value === null || value === undefined) delete state.content[key];
  else state.content[key] = value;
  updateDirty();
  applyDraftToPreview();
  syncCompareHeroEditor();
}

const compareTransformKeys = new Set(['hero_art_scale', 'hero_art_scale_mobile', 'hero_art_x', 'hero_art_y']);

function renderCompareHeroEditor() {
  return `<div class="content-field hero-transform-field">
    <div class="content-field-head"><label>Enquadramento visual do herói</label><button class="field-reset" type="button" data-reset-hero-transform>Restaurar posição</button></div>
    <p class="hero-transform-help">Arraste o herói com o dedo ou mouse. Use a barra para aproximar ou afastar.</p>
    <div class="hero-transform-mode" role="group" aria-label="Dispositivo da prévia"><button class="is-active" type="button" data-hero-mode="mobile">Mobile</button><button type="button" data-hero-mode="desktop">Desktop</button></div>
    <div class="hero-transform-stage is-mobile" data-hero-transform-stage><div class="hero-transform-bg"></div><img class="hero-transform-art" alt="Prévia do herói"><span>ARRASTE PARA POSICIONAR</span></div>
    <label class="hero-zoom-control"><span><b>Zoom</b><output data-hero-zoom-output>88%</output></span><input type="range" min="50" max="130" step="1" value="88" data-hero-zoom></label>
    <div class="hero-transform-coordinates"><span>Horizontal <b data-hero-x>50%</b></span><span>Vertical <b data-hero-y>52%</b></span></div>
  </div>`;
}

function groupFields(fields) {
  return fields.reduce((groups, field) => {
    (groups[field.group] ||= []).push(field);
    return groups;
  }, {});
}

function renderBasicField(field) {
  const value = state.content[field.key] ?? '';
  const isNumber = field.type === 'number';
  const constraints = isNumber
    ? `min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 1}" inputmode="decimal"`
    : `maxlength="${field.max || 500}"`;
  const common = `data-content-key="${escapeHtml(field.key)}" ${constraints}`;
  const control = field.type === 'textarea'
    ? `<textarea class="admin-textarea" ${common} rows="3" placeholder="Vazio mantém o texto padrão">${escapeHtml(value)}</textarea>`
    : `<input class="admin-input" ${common} type="${field.type === 'url' ? 'url' : isNumber ? 'number' : 'text'}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder ?? (field.type === 'url' ? 'https://…' : 'Vazio mantém o conteúdo padrão'))}">`;
  return `<div class="content-field" data-field-key="${escapeHtml(field.key)}"><div class="content-field-head"><label>${escapeHtml(field.label)}</label><button class="field-reset" type="button" data-reset-key="${escapeHtml(field.key)}">Restaurar padrão</button></div>${control}${!isNumber && field.max ? `<div class="field-counter"><span>${String(value).length}</span> / ${field.max}</div>` : ''}</div>`;
}

function renderHeroField(field) {
  const value = String(state.content[field.key] ?? '');
  const options = state.heroes.map(hero => `<option value="${escapeHtml(hero.id)}" ${String(hero.id) === value ? 'selected' : ''}>${escapeHtml(hero.name)}</option>`).join('');
  return `<div class="content-field" data-field-key="${escapeHtml(field.key)}"><div class="content-field-head"><label>${escapeHtml(field.label)}</label><button class="field-reset" type="button" data-reset-key="${escapeHtml(field.key)}">Usar primeiro da lista</button></div><select class="admin-select" data-content-key="${escapeHtml(field.key)}"><option value="">Primeiro herói ativo</option>${options}</select><div class="field-counter">A imagem e os dados vêm do Editor de Herói.</div></div>`;
}

function renderToggleField(field) {
  const checked = state.content[field.key] !== false;
  return `<div class="content-field" data-field-key="${escapeHtml(field.key)}"><label class="toggle-field"><span>${escapeHtml(field.label)}</span><input type="checkbox" data-content-toggle="${escapeHtml(field.key)}" ${checked ? 'checked' : ''}></label><button class="field-reset" type="button" data-reset-key="${escapeHtml(field.key)}">Restaurar padrão visível</button></div>`;
}

function renderImageField(field) {
  return `<div class="content-field image-field" data-field-key="${escapeHtml(field.key)}"><div class="content-field-head"><label>${escapeHtml(field.label)}</label><button class="field-reset" type="button" data-reset-key="${escapeHtml(field.key)}">Restaurar padrão</button></div><div data-image-editor="${escapeHtml(field.key)}"></div></div>`;
}

function fieldTab(field) {
  if (field.tab && editorTabs.some(tab => tab.key === field.tab)) return field.tab;
  if (field.type === 'image' || compareTransformKeys.has(field.key)) return 'media';
  if (field.type === 'toggle' || field.group === 'Visibilidade') return 'visibility';
  if (['SEO', 'Cabeçalho', 'Filtros', 'Geral'].includes(field.group)) return 'information';
  return 'content';
}

function availableEditorTabs() {
  const keys = new Set(state.page.fields.map(fieldTab));
  return editorTabs.filter(tab => tab.key === 'preview' || keys.has(tab.key));
}

function renderEditorTabs() {
  const tabs = availableEditorTabs();
  if (!tabs.some(tab => tab.key === state.activeTab)) state.activeTab = tabs[0]?.key || 'preview';
  elements.tabs.innerHTML = tabs.map(tab => `<button type="button" class="content-editor-tab ${tab.key === state.activeTab ? 'is-active' : ''}" data-editor-tab="${tab.key}"><strong>${tab.label}</strong><span>${tab.description}</span></button>`).join('');
  elements.workspace.classList.toggle('preview-mode', state.activeTab === 'preview');
}

function renderFieldControl(field) {
  if (field.type === 'image') return renderImageField(field);
  if (field.type === 'toggle') return renderToggleField(field);
  if (field.type === 'hero') return renderHeroField(field);
  return renderBasicField(field);
}

function renderFields() {
  renderEditorTabs();
  if (state.activeTab === 'preview') {
    elements.fields.innerHTML = '';
    return;
  }

  const tabFields = state.page.fields.filter(field => fieldTab(field) === state.activeTab && !compareTransformKeys.has(field.key));
  const groups = groupFields(tabFields);
  const names = Object.keys(groups);
  const storedGroup = state.activeGroups[state.activeTab];
  const activeGroup = names.includes(storedGroup) ? storedGroup : names[0];
  state.activeGroups[state.activeTab] = activeGroup;
  const tab = editorTabs.find(item => item.key === state.activeTab);
  const groupNav = names.length > 1 ? `<nav class="content-subtabs" aria-label="Áreas de ${tab?.label || 'edição'}">${names.map(name => `<button type="button" class="${name === activeGroup ? 'is-active' : ''}" data-editor-group="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}</nav>` : '';
  const fields = groups[activeGroup] || [];
  const visualEditor = state.page.key === 'compare' && state.activeTab === 'media' ? renderCompareHeroEditor() : '';
  elements.fields.innerHTML = `${groupNav}<article class="content-section-card"><header><div><small>${escapeHtml(tab?.label || '')}</small><h2>${escapeHtml(activeGroup || tab?.label || '')}</h2><p>${escapeHtml(tab?.description || '')}</p></div><span>${fields.length + (visualEditor ? 1 : 0)} ${fields.length + (visualEditor ? 1 : 0) === 1 ? 'controle' : 'controles'}</span></header><div class="content-section-body ${state.activeTab === 'media' ? 'is-media' : ''}">${fields.map(renderFieldControl).join('')}${visualEditor}</div></article>`;

  fields.filter(field => field.type === 'image').forEach(mountImageEditor);
  mountCompareHeroEditor();
}

function mediaUrl(key, fallback = '') {
  const value = state.content[key];
  return String(typeof value === 'string' ? value : value?.url || fallback);
}

function syncCompareHeroEditor() {
  const stage = elements.fields.querySelector('[data-hero-transform-stage]');
  if (!stage) return;
  const mode = stage.dataset.mode || 'mobile';
  const x = Number(state.content.hero_art_x ?? 50);
  const y = Number(state.content.hero_art_y ?? 52);
  const scaleKey = mode === 'mobile' ? 'hero_art_scale_mobile' : 'hero_art_scale';
  const scale = Number(state.content[scaleKey] ?? (mode === 'mobile' ? 88 : 100));
  const art = stage.querySelector('.hero-transform-art');
  const bg = stage.querySelector('.hero-transform-bg');
  art.src = mediaUrl('hero_art', '../assets/echo-arena-hero.png?v=2');
  art.style.left = `${x}%`;
  art.style.top = `${y}%`;
  art.style.transform = `translate(-50%,-50%) scale(${scale / 100})`;
  const background = mediaUrl('mine_card_background');
  bg.style.backgroundImage = background ? `linear-gradient(115deg,rgba(5,7,14,.58),rgba(7,8,17,.18)),url("${background.replaceAll('"', '%22')}")` : '';
  const slider = elements.fields.querySelector('[data-hero-zoom]');
  slider.min = '50'; slider.max = mode === 'mobile' ? '130' : '140'; slider.value = String(scale);
  elements.fields.querySelector('[data-hero-zoom-output]').textContent = `${scale}%`;
  elements.fields.querySelector('[data-hero-x]').textContent = `${Math.round(x)}%`;
  elements.fields.querySelector('[data-hero-y]').textContent = `${Math.round(y)}%`;
}

function mountCompareHeroEditor() {
  const stage = elements.fields.querySelector('[data-hero-transform-stage]');
  if (!stage) return;
  stage.dataset.mode = 'mobile';
  let drag = null;
  const move = event => {
    if (!drag) return;
    const rect = stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, drag.x + ((event.clientX - drag.clientX) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, drag.y + ((event.clientY - drag.clientY) / rect.height) * 100));
    setValue('hero_art_x', Math.round(x));
    setValue('hero_art_y', Math.round(y));
  };
  stage.addEventListener('pointerdown', event => {
    drag = { clientX: event.clientX, clientY: event.clientY, x: Number(state.content.hero_art_x ?? 50), y: Number(state.content.hero_art_y ?? 52) };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('pointercancel', () => { drag = null; });
  elements.fields.querySelectorAll('[data-hero-mode]').forEach(button => button.addEventListener('click', () => {
    stage.dataset.mode = button.dataset.heroMode;
    stage.classList.toggle('is-mobile', button.dataset.heroMode === 'mobile');
    elements.fields.querySelectorAll('[data-hero-mode]').forEach(item => item.classList.toggle('is-active', item === button));
    syncCompareHeroEditor();
  }));
  elements.fields.querySelector('[data-hero-zoom]').addEventListener('input', event => {
    setValue(stage.dataset.mode === 'mobile' ? 'hero_art_scale_mobile' : 'hero_art_scale', Number(event.target.value));
  });
  elements.fields.querySelector('[data-reset-hero-transform]').addEventListener('click', () => {
    ['hero_art_scale', 'hero_art_scale_mobile', 'hero_art_x', 'hero_art_y'].forEach(key => delete state.content[key]);
    updateDirty(); applyDraftToPreview(); syncCompareHeroEditor();
  });
  syncCompareHeroEditor();
}

function getImage(key) {
  const value = state.content[key];
  const defaults = { url: '', alt: '', position: '50% 50%', fit: 'cover', zoom: 100 };
  if (typeof value === 'string') return { ...defaults, url: value };
  return value && typeof value === 'object' ? { ...defaults, ...value } : defaults;
}

function imageCoordinates(image) {
  const values = String(image.position || '50% 50%').match(/-?\d+(?:\.\d+)?/g) || [];
  return { x: Math.max(0, Math.min(100, Number(values[0] ?? 50))), y: Math.max(0, Math.min(100, Number(values[1] ?? 50))) };
}

function updateImagePreview(editor, image) {
  const preview = editor.querySelector('.image-preview');
  const tag = preview.querySelector('img');
  const { x, y } = imageCoordinates(image);
  const zoom = Math.max(50, Math.min(200, Number(image.zoom ?? 100)));
  tag.src = image.url || '';
  tag.alt = image.alt || '';
  tag.style.objectFit = image.fit || 'cover';
  tag.style.transform = `translate(${-50 + (x - 50)}%, ${-50 + (y - 50)}%) scale(${zoom / 100})`;
  editor.querySelector('.image-position').value = `${Math.round(x)}% ${Math.round(y)}%`;
  editor.querySelector('.image-position-value').textContent = `X ${Math.round(x)}% · Y ${Math.round(y)}%`;
  editor.querySelector('.image-zoom').value = String(zoom);
  editor.querySelector('.image-zoom-value').textContent = `${Math.round(zoom)}%`;
  preview.classList.toggle('has-image', Boolean(image.url));
}

function mountImageEditor(field) {
  const host = elements.fields.querySelector(`[data-image-editor="${CSS.escape(field.key)}"]`);
  const fragment = elements.imageTemplate.content.cloneNode(true);
  host.appendChild(fragment);
  const image = getImage(field.key);
  const editor = host.querySelector('.image-editor');
  if (state.page.key === 'compare' && field.key === 'hero_art') editor.classList.add('is-source-only');
  editor.querySelector('.image-url').value = image.url || '';
  editor.querySelector('.image-alt').value = image.alt || '';
  editor.querySelector('.image-position').value = image.position || '50% 50%';
  editor.querySelector('.image-fit').value = image.fit || 'cover';
  editor.querySelector('.image-zoom').value = String(image.zoom ?? 100);
  updateImagePreview(editor, image);

  const collectImage = () => {
    const url = editor.querySelector('.image-url').value.trim();
    if (!url) return setValue(field.key, null);
    const next = {
      ...getImage(field.key),
      url,
      alt: editor.querySelector('.image-alt').value.trim(),
      position: editor.querySelector('.image-position').value,
      fit: editor.querySelector('.image-fit').value,
      zoom: Number(editor.querySelector('.image-zoom').value)
    };
    setValue(field.key, next);
    updateImagePreview(editor, next);
  };

  editor.querySelectorAll('.image-url,.image-alt,.image-position,.image-fit,.image-zoom').forEach(control => {
    control.addEventListener('input', collectImage);
    control.addEventListener('change', collectImage);
  });
  editor.querySelector('.remove-image').addEventListener('click', () => {
    setValue(field.key, null);
    editor.querySelector('.image-url').value = '';
    editor.querySelector('.image-alt').value = '';
    editor.querySelector('.image-position').value = '50% 50%';
    editor.querySelector('.image-zoom').value = '100';
    updateImagePreview(editor, getImage(field.key));
  });
  editor.querySelector('.center-image').addEventListener('click', () => {
    editor.querySelector('.image-position').value = '50% 50%';
    collectImage();
  });
  const preview = editor.querySelector('.image-preview');
  let drag = null;
  preview.addEventListener('pointerdown', event => {
    if (!getImage(field.key).url) return;
    const point = imageCoordinates(getImage(field.key));
    drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: point.x, y: point.y };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add('is-dragging');
  });
  preview.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const x = Math.max(0, Math.min(100, drag.x + ((event.clientX - drag.clientX) / (preview.clientWidth || 1)) * 100));
    const y = Math.max(0, Math.min(100, drag.y + ((event.clientY - drag.clientY) / (preview.clientHeight || 1)) * 100));
    editor.querySelector('.image-position').value = `${Math.round(x)}% ${Math.round(y)}%`;
    collectImage();
  });
  const stopDrag = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    preview.classList.remove('is-dragging');
    if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId);
  };
  preview.addEventListener('pointerup', stopDrag);
  preview.addEventListener('pointercancel', stopDrag);
  editor.querySelector('input[type="file"]').addEventListener('change', event => uploadImage(field, editor, event.target.files?.[0]));
}

async function uploadImage(field, editor, file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return setMessage('Escolha um arquivo de imagem válido.', 'error');
  if (file.size > 8 * 1024 * 1024) return setMessage('A imagem deve ter no máximo 8 MB.', 'error');
  const progress = editor.querySelector('.upload-progress');
  progress.hidden = false;
  state.uploading += 1;
  elements.save.disabled = true;
  try {
    const safeKey = field.key.replace(/[^a-z0-9_-]/gi, '-');
    const url = await uploadMedia(file, `site-content/${state.page.key}/${safeKey}`);
    const next = { url, path: url, alt: editor.querySelector('.image-alt').value.trim(), position: editor.querySelector('.image-position').value, fit: editor.querySelector('.image-fit').value, zoom: Number(editor.querySelector('.image-zoom').value) };
    editor.querySelector('.image-url').value = next.url;
    setValue(field.key, next);
    updateImagePreview(editor, next);
    setMessage('Imagem enviada. Clique em Publicar alterações para colocá-la no site.', 'ok');
  } catch (error) {
    console.error('[site-content upload]', error);
    setMessage(error.message || 'Não foi possível enviar a imagem.', 'error');
  } finally {
    progress.hidden = true;
    state.uploading -= 1;
    elements.save.disabled = state.uploading > 0;
  }
}

function updatePageHeader() {
  elements.pageName.textContent = state.page.label;
  elements.pageDescription.textContent = state.page.description;
  elements.openPage.href = state.page.url;
  elements.preview.src = `${state.page.url}${state.page.url.includes('?') ? '&' : '?'}cms=${Date.now()}`;
}

function applyDraftToPreview() {
  const win = elements.preview.contentWindow;
  if (!win?.EchoSiteContent?.apply) return;
  win.EchoSiteContent.apply(state.content);
}

function isMissingTable(error) {
  return error?.code === '42P01' || /site_pages|schema cache|does not exist/i.test(error?.message || '');
}

async function loadPage(pageKey, { force = false } = {}) {
  if (!force && isDirty() && !window.confirm('Descartar as alterações ainda não publicadas?')) {
    elements.pageSelect.value = state.page.key;
    return;
  }
  state.page = getContentPage(pageKey);
  state.activeTab = 'information';
  state.activeGroups = {};
  elements.fields.innerHTML = '<div class="content-loading">Carregando conteúdo…</div>';
  setMessage('Carregando…');
  updatePageHeader();
  try {
    if (state.page.key === 'home' && !state.heroes.length) {
      const heroesResult = await supabase.from('heroes').select('id,name').eq('enabled', true).order('display_order', { ascending: true, nullsFirst: false }).order('name');
      if (!heroesResult.error) state.heroes = heroesResult.data || [];
    }
    const { data, error } = await supabase.from('site_pages').select('*').eq('page_key', state.page.key).maybeSingle();
    if (error) throw error;
    state.row = data;
    state.content = structuredClone(data?.content || {});
    state.original = structuredClone(state.content);
    state.published = data?.published !== false;
    state.originalPublished = state.published;
    elements.published.checked = state.published;
    elements.warning.hidden = true;
    renderFields();
    updateDirty();
    setMessage(data ? 'Conteúdo sincronizado.' : 'Página pronta para receber conteúdo.');
  } catch (error) {
    console.error('[site-content load]', error);
    state.row = null; state.content = {}; state.original = {}; state.published = true; state.originalPublished = true;
    elements.published.checked = true;
    renderFields();
    elements.warning.hidden = !isMissingTable(error);
    setMessage(error.message || 'Não foi possível carregar o conteúdo.', 'error');
  }
}

async function savePage() {
  if (state.saving || state.uploading) return;
  state.saving = true;
  elements.save.disabled = true;
  elements.save.textContent = 'Publicando…';
  setMessage('Salvando conteúdo…');
  try {
    for (const field of state.page.fields.filter(item => item.type === 'url')) {
      const value = String(state.content[field.key] || '').trim();
      if (value && !/^(https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/i.test(value)) {
        throw new Error(`O campo “${field.label}” precisa usar https:// ou um link interno válido.`);
      }
    }
    for (const field of state.page.fields.filter(item => item.type === 'image')) {
      const value = state.content[field.key];
      const url = String(typeof value === 'string' ? value : value?.url || '').trim();
      if (url && !/^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(url)) {
        throw new Error(`A imagem “${field.label}” precisa usar https:// ou um caminho interno válido.`);
      }
    }
    const { data: { user } } = await supabase.auth.getUser();
    const payload = { page_key: state.page.key, content: state.content, published: state.published, updated_at: new Date().toISOString(), updated_by: user?.id || null };
    const { data, error } = await supabase.from('site_pages').upsert(payload, { onConflict: 'page_key' }).select('*').single();
    if (error) throw error;
    state.row = data; state.original = structuredClone(state.content); state.originalPublished = state.published;
    updateDirty(); elements.warning.hidden = true;
    setMessage('Alterações publicadas com sucesso.', 'ok');
    elements.preview.src = `${state.page.url}?cms=${Date.now()}`;
  } catch (error) {
    console.error('[site-content save]', error);
    elements.warning.hidden = !isMissingTable(error);
    setMessage(error.message || 'Não foi possível publicar.', 'error');
  } finally {
    state.saving = false; elements.save.disabled = false; elements.save.textContent = 'Publicar alterações';
  }
}

elements.pageSelect.innerHTML = SITE_CONTENT_PAGES.map(page => `<option value="${escapeHtml(page.key)}">${escapeHtml(page.label)}</option>`).join('');
elements.pageSelect.addEventListener('change', () => loadPage(elements.pageSelect.value));
elements.tabs.addEventListener('click', event => {
  const tab = event.target.closest('[data-editor-tab]');
  if (!tab) return;
  state.activeTab = tab.dataset.editorTab;
  renderFields();
  if (state.activeTab === 'preview') elements.preview.focus();
});
elements.published.addEventListener('change', () => { state.published = elements.published.checked; updateDirty(); });
elements.fields.addEventListener('input', event => {
  const control = event.target.closest('[data-content-key]');
  if (!control) return;
  setValue(control.dataset.contentKey, control.value.trim());
  const counter = control.closest('.content-field')?.querySelector('.field-counter span');
  if (counter) counter.textContent = control.value.length;
});
elements.fields.addEventListener('change', event => {
  const toggle = event.target.closest('[data-content-toggle]');
  if (toggle) setValue(toggle.dataset.contentToggle, toggle.checked);
  const control = event.target.closest('[data-content-key]');
  if (control) setValue(control.dataset.contentKey, control.value.trim());
});
elements.fields.addEventListener('click', event => {
  const group = event.target.closest('[data-editor-group]');
  if (group) { state.activeGroups[state.activeTab] = group.dataset.editorGroup; renderFields(); return; }
  const reset = event.target.closest('[data-reset-key]');
  if (reset) { delete state.content[reset.dataset.resetKey]; renderFields(); updateDirty(); elements.preview.src = `${state.page.url}?cms=${Date.now()}`; }
});
elements.save.addEventListener('click', savePage);
elements.reload.addEventListener('click', () => loadPage(state.page.key, { force: true }));
elements.refresh.addEventListener('click', () => { elements.preview.src = `${state.page.url}?cms=${Date.now()}`; });
elements.preview.addEventListener('load', () => setTimeout(applyDraftToPreview, 400));
window.addEventListener('beforeunload', event => { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } });

await loadPage(state.page.key, { force: true });

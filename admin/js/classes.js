import { supabase } from '../../js/supabase.js';

/* =========================================================
   ELEMENTOS
========================================================= */

const list = document.getElementById('classes-list');
const message = document.getElementById('message');
const refreshButton = document.getElementById('refresh');

/* =========================================================
   ESTADO
========================================================= */

let classes = [];
let savingId = null;

/* Mesma paleta do site público: sem cor definida, o slug
   determina uma cor estável em vez de cinza. */
const CLASS_PALETTE = [
  '#F4D77A', '#8FE9FF', '#B794FF', '#4ADE80',
  '#F87171', '#FBBF24', '#67E8F9', '#F0A6D0'
];

/* =========================================================
   UTILITÁRIOS
========================================================= */

function setMessage(text = '', type = '') {
  if (!message) return;
  message.textContent = text;
  message.className = `classes-message${type ? ` ${type}` : ''}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isHex(value = '') {
  return /^#[0-9a-f]{6}$/i.test(String(value).trim());
}

function fallbackColor(item) {
  const key = String(item.slug || item.name || '');
  let sum = 0;

  for (let i = 0; i < key.length; i += 1) {
    sum = (sum + key.charCodeAt(i)) % 997;
  }

  return CLASS_PALETTE[sum % CLASS_PALETTE.length];
}

function colorOf(item) {
  return isHex(item.color) ? item.color.toUpperCase() : fallbackColor(item);
}

/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function renderRow(item) {
  const color = colorOf(item);
  const isCustom = isHex(item.color);
  const isBusy = savingId === item.id;

  return `
    <article class="class-row" data-class-id="${escapeHtml(item.id)}"
             style="--class-color:${escapeHtml(color)}">
      <div class="class-identity">
        <strong>${escapeHtml(item.name || 'Sem nome')}</strong>
        <span>
          ${escapeHtml(item.slug || 'sem identificador')}
          ${isCustom ? '' : ' · cor automática'}
        </span>
      </div>

      <div class="class-field">
        <label for="color-${escapeHtml(item.id)}">Cor</label>

        <div class="class-color-controls">
          <input
            id="color-${escapeHtml(item.id)}"
            type="color"
            value="${escapeHtml(color)}"
            data-color-picker="${escapeHtml(item.id)}"
          >

          <input
            class="admin-input"
            type="text"
            maxlength="7"
            value="${escapeHtml(color)}"
            data-color-text="${escapeHtml(item.id)}"
            placeholder="#RRGGBB"
          >
        </div>
      </div>

      <div class="class-preview">
        <div class="class-preview-thumb"></div>

        <div class="class-preview-copy">
          <strong>Nome do herói</strong>
          <span>${escapeHtml(item.name || '')}</span>
        </div>
      </div>

      <div class="class-actions">
        <button
          class="admin-button primary"
          type="button"
          data-save="${escapeHtml(item.id)}"
          ${isBusy ? 'disabled' : ''}
        >
          ${isBusy ? 'Salvando...' : 'Salvar'}
        </button>

        <button
          class="admin-button"
          type="button"
          data-reset="${escapeHtml(item.id)}"
          ${isBusy ? 'disabled' : ''}
          title="Volta para a cor automática"
        >
          Automática
        </button>
      </div>
    </article>
  `;
}

function render() {
  if (!classes.length) {
    list.innerHTML = '<div class="classes-empty">Nenhuma classe cadastrada.</div>';
    return;
  }

  list.innerHTML = classes.map(renderRow).join('');
}

/* Atualiza a prévia enquanto o usuário mexe, sem recarregar. */
function previewColor(id, color) {
  const row = list.querySelector(`[data-class-id="${CSS.escape(id)}"]`);
  if (row) row.style.setProperty('--class-color', color);
}

/* =========================================================
   AÇÕES
========================================================= */

async function saveColor(id, color) {
  const item = classes.find(entry => entry.id === String(id) || entry.id === Number(id));
  if (!item) return;

  if (color !== null && !isHex(color)) {
    setMessage('Use o formato #RRGGBB.', 'error');
    return;
  }

  savingId = item.id;
  render();
  setMessage('Salvando...');

  try {
    const { error } = await supabase
      .from('hero_classes')
      .update({ color })
      .eq('id', item.id);

    if (error) throw error;

    item.color = color;

    setMessage(
      color
        ? `Cor de "${item.name}" atualizada.`
        : `"${item.name}" voltou para a cor automática.`,
      'ok'
    );
  } catch (error) {
    console.error('Erro ao salvar cor:', error);
    setMessage(error.message || 'Não foi possível salvar a cor.', 'error');
  } finally {
    savingId = null;
    render();
  }
}

/* =========================================================
   EVENTOS (delegação — as linhas são redesenhadas)
========================================================= */

list?.addEventListener('input', (event) => {
  const picker = event.target.closest('[data-color-picker]');

  if (picker) {
    const id = picker.dataset.colorPicker;
    const text = list.querySelector(`[data-color-text="${CSS.escape(id)}"]`);

    if (text) text.value = picker.value.toUpperCase();
    previewColor(id, picker.value);
    return;
  }

  const text = event.target.closest('[data-color-text]');

  if (text && isHex(text.value)) {
    const id = text.dataset.colorText;
    const picker = list.querySelector(`[data-color-picker="${CSS.escape(id)}"]`);

    if (picker) picker.value = text.value;
    previewColor(id, text.value);
  }
});

list?.addEventListener('click', (event) => {
  const saveButton = event.target.closest('[data-save]');

  if (saveButton) {
    const id = saveButton.dataset.save;
    const text = list.querySelector(`[data-color-text="${CSS.escape(id)}"]`);

    saveColor(id, text?.value?.trim().toUpperCase() ?? null);
    return;
  }

  const resetButton = event.target.closest('[data-reset]');

  if (resetButton) {
    saveColor(resetButton.dataset.reset, null);
  }
});

refreshButton?.addEventListener('click', () => load());

/* =========================================================
   CARREGAMENTO
========================================================= */

async function load() {
  list.innerHTML = '<div class="classes-empty">Carregando classes...</div>';
  setMessage('Carregando...');

  try {
    const { data, error } = await supabase
      .from('hero_classes')
      .select('id, name, slug, color, icon')
      .order('name');

    if (error) throw error;

    classes = data ?? [];
    setMessage('');
    render();
  } catch (error) {
    console.error('Erro ao carregar classes:', error);
    list.innerHTML = '<div class="classes-empty">Não foi possível carregar as classes.</div>';
    setMessage(error.message || 'Não foi possível carregar as classes.', 'error');
  }
}

await load();

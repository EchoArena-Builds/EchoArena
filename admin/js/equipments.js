import {
  listEquipments,
  deleteEquipment
} from './equipment-api.js';

import {
  publicMediaUrl
} from './equipment-media.js';

const list =
  document.getElementById(
    'equipment-list'
  );

const search =
  document.getElementById(
    'search'
  );

const setFilter =
  document.getElementById(
    'set-filter'
  );

const slotFilter =
  document.getElementById(
    'slot-filter'
  );

const message =
  document.getElementById(
    'message'
  );

let equipments = [];
let isLoading = false;
let activeActionId = null;

/* =========================================================
   UTILITÁRIOS
========================================================= */

function setMessage(
  text = '',
  type = ''
) {
  if (!message) {
    return;
  }

  message.textContent = text;

  message.className =
    `equipment-message${type ? ` ${type}` : ''}`;
}

function escapeHtml(
  value = ''
) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeText(
  value = ''
) {
  return String(value)
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .trim();
}

function getEquipmentSetName(
  item
) {
  return (
    item.equipment_sets?.name ||
    item.equipment_set?.name ||
    item.set_name ||
    'Sem conjunto'
  );
}

function getEquipmentSlotName(
  item
) {
  return (
    item.equipment_slots?.name ||
    item.equipment_slot?.name ||
    item.slot_name ||
    item.slot ||
    'Sem slot'
  );
}

function getEquipmentSlug(
  item
) {
  return (
    item.slug ||
    item.code ||
    ''
  );
}

/* =========================================================
   FILTROS
========================================================= */

function populateFilters() {
  const sets = [
    ...new Set(
      equipments
        .map(
          getEquipmentSetName
        )
        .filter(Boolean)
    )
  ].sort(
    (first, second) =>
      first.localeCompare(
        second,
        'pt-BR'
      )
  );

  const slots = [
    ...new Set(
      equipments
        .map(
          getEquipmentSlotName
        )
        .filter(Boolean)
        .filter(slotName => {
          const normalizedSlot =
            normalizeText(slotName)
              .replace(
                /[^a-z0-9]/g,
                ''
              );

          /*
           * E.Y.E. é nome de equipamento,
           * não uma categoria de slot.
           *
           * Mantemos os registros intactos,
           * mas ocultamos essa opção do filtro.
           */
          return normalizedSlot !== 'eye';
        })
    )
  ].sort(
    (first, second) =>
      first.localeCompare(
        second,
        'pt-BR'
      )
  );

  setFilter.innerHTML = `
    <option value="all">
      Todos os conjuntos
    </option>

    ${sets.map(setName => `
      <option value="${escapeHtml(setName)}">
        ${escapeHtml(setName)}
      </option>
    `).join('')}
  `;

  slotFilter.innerHTML = `
    <option value="all">
      Todos os slots
    </option>

    ${slots.map(slotName => `
      <option value="${escapeHtml(slotName)}">
        ${escapeHtml(slotName)}
      </option>
    `).join('')}
  `;
}

function getFilteredEquipments() {
  const query =
    normalizeText(
      search?.value
    );

  const selectedSet =
    setFilter?.value ||
    'all';

  const selectedSlot =
    slotFilter?.value ||
    'all';

  return equipments
    .filter(item => {
      const setName =
        getEquipmentSetName(item);

      const slotName =
        getEquipmentSlotName(item);

      const matchesQuery =
        !query ||
        normalizeText(
          item.name
        ).includes(query) ||
        normalizeText(
          item.slug
        ).includes(query) ||
        normalizeText(
          setName
        ).includes(query) ||
        normalizeText(
          slotName
        ).includes(query);

      const matchesSet =
        selectedSet === 'all' ||
        setName === selectedSet;

      const matchesSlot =
        selectedSlot === 'all' ||
        slotName === selectedSlot;

      return (
        matchesQuery &&
        matchesSet &&
        matchesSlot
      );
    })
    .sort(
      (first, second) =>
        String(
          first.name || ''
        ).localeCompare(
          String(
            second.name || ''
          ),
          'pt-BR'
        )
    );
}

/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function renderEquipmentCard(
  item
) {
  const imageUrl =
    item.image_path
      ? publicMediaUrl(
          item.image_path
        )
      : '';

  const setName =
    getEquipmentSetName(
      item
    );

  const slotName =
    getEquipmentSlotName(
      item
    );

  const slug =
    getEquipmentSlug(
      item
    );

  const isBusy =
    activeActionId === item.id;

  return `
    <article
      class="equipment-card"
      data-equipment-id="${escapeHtml(item.id)}"
    >
      <div class="equipment-card-media">
        ${
          imageUrl
            ? `
              <img
                src="${escapeHtml(imageUrl)}"
                alt="${escapeHtml(item.name || '')}"
                loading="lazy"
              >
            `
            : `
              <span class="equipment-card-media-empty">
                Sem imagem
              </span>
            `
        }
      </div>

      <div class="equipment-card-body">
        <div class="equipment-card-heading">
          <h2>
            ${escapeHtml(
              item.name ||
              'Equipamento sem nome'
            )}
          </h2>

          <p>
            ${escapeHtml(
              slug ||
              'sem-identificador'
            )}
          </p>
        </div>

        <div class="equipment-card-meta">
          <div class="equipment-meta-item">
            <span>
              Conjunto
            </span>

            <strong>
              ${escapeHtml(setName)}
            </strong>
          </div>

          <div class="equipment-meta-item">
            <span>
              Slot
            </span>

            <strong>
              ${escapeHtml(slotName)}
            </strong>
          </div>
        </div>

        <div class="equipment-card-actions">
          <a
            class="admin-button"
            href="./equipment-editor.html?id=${encodeURIComponent(item.id)}"
          >
            Editar
          </a>

          <button
            class="admin-button danger"
            type="button"
            data-delete="${escapeHtml(item.id)}"
            ${isBusy ? 'disabled' : ''}
          >
            ${
              isBusy
                ? 'Excluindo...'
                : 'Excluir'
            }
          </button>
        </div>
      </div>
    </article>
  `;
}

function render() {
  const rows =
    getFilteredEquipments();

  if (!rows.length) {
    list.innerHTML = `
      <div class="equipment-empty">
        Nenhum equipamento encontrado.
      </div>
    `;

    return;
  }

  list.innerHTML =
    rows
      .map(
        renderEquipmentCard
      )
      .join('');

  bindCardActions();
}

/* =========================================================
   EXCLUSÃO
========================================================= */

async function removeEquipment(
  equipmentId
) {
  const item =
    equipments.find(
      equipment =>
        String(equipment.id) ===
        String(equipmentId)
    );

  if (!item) {
    return;
  }

  const confirmed =
    window.confirm(
      `Excluir "${item.name}" permanentemente?\n\n` +
      'Os dados e estatísticas deste equipamento serão removidos.'
    );

  if (!confirmed) {
    return;
  }

  activeActionId =
    item.id;

  render();

  setMessage(
    `Excluindo ${item.name}...`
  );

  try {
    await deleteEquipment(
      item.id
    );

    equipments =
      equipments.filter(
        equipment =>
          equipment.id !== item.id
      );

    populateFilters();
    render();

    setMessage(
      `${item.name} foi excluído.`,
      'ok'
    );
  } catch (error) {
    console.error(
      'Erro ao excluir equipamento:',
      error
    );

    setMessage(
      error.message ||
      'Não foi possível excluir o equipamento.',
      'error'
    );
  } finally {
    activeActionId = null;
    render();
  }
}

function bindCardActions() {
  list
    .querySelectorAll(
      '[data-delete]'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          removeEquipment(
            button.dataset.delete
          );
        }
      );
    });
}

/* =========================================================
   CARREGAMENTO
========================================================= */

async function load() {
  if (isLoading) {
    return;
  }

  isLoading = true;

  list.innerHTML = `
    <div class="equipment-empty">
      Carregando equipamentos...
    </div>
  `;

  setMessage(
    'Carregando...'
  );

  try {
    equipments =
      await listEquipments();

    populateFilters();
    render();

    setMessage('');
  } catch (error) {
    console.error(
      'Erro ao carregar equipamentos:',
      error
    );

    list.innerHTML = `
      <div class="equipment-empty">
        Não foi possível carregar os equipamentos.
      </div>
    `;

    setMessage(
      error.message ||
      'Não foi possível carregar os equipamentos.',
      'error'
    );
  } finally {
    isLoading = false;
  }
}

/* =========================================================
   EVENTOS
========================================================= */

search?.addEventListener(
  'input',
  render
);

setFilter?.addEventListener(
  'change',
  render
);

slotFilter?.addEventListener(
  'change',
  render
);

await load();

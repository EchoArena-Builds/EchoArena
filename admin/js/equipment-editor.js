import {
  requireAdmin,
  logoutAdmin
} from './admin-auth.js';

import {
  loadEquipmentMeta,
  getEquipmentBundle,
  saveEquipmentBundle,
  upsertSet
} from './equipment-api.js';

import {
  uploadEquipmentImage,
  publicMediaUrl
} from './equipment-media.js';

await requireAdmin();

const logoutButton =
  document.getElementById('logout');

if (logoutButton) {
  logoutButton.onclick =
    logoutAdmin;
}

const IMPORT_KEY =
  'equipment-import-draft';

const IMPORT_BACKUP_KEY =
  'equipment-import-form-backup';

/*
 * Slots exibidos no cadastro.
 * Os nomes são fixos na interface; os slugs apontam para
 * os registros já existentes em equipment_slots.
 */
const REQUIRED_SLOT_OPTIONS = [
  { label: 'Cabeça', slugs: ['cabeca'] },
  { label: 'Peito', slugs: ['body', 'peito', 'corpo'] },
  { label: 'Mãos', slugs: ['maos', 'hands'] },
  { label: 'Pés', slugs: ['leg', 'pes', 'perna'] },
  { label: 'Anel', slugs: ['ring', 'anel'] },
  { label: 'Gadget', slugs: ['especial', 'gadget'] }
];

const params =
  new URLSearchParams(
    location.search
  );

const equipmentId =
  params.get('id');

const importedRaw =
  sessionStorage.getItem(
    IMPORT_KEY
  );

let draft = null;

if (importedRaw) {
  try {
    draft =
      JSON.parse(
        importedRaw
      );
  } catch (error) {
    console.warn(
      'Rascunho de importação inválido:',
      error
    );
  }
}

const form =
  document.getElementById('form');

const message =
  document.getElementById('message');

const rarityHost =
  document.getElementById('rarities');

const bonusHost =
  document.getElementById('bonuses');

const importBanner =
  document.getElementById(
    'import-banner'
  );

const importSummary =
  document.getElementById(
    'import-summary'
  );

const undoImportButton =
  document.getElementById(
    'undo-import'
  );

let meta;
let currentBundle = null;
let importBackup = null;
let importWasApplied = false;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function setMessage(
  text = '',
  type = ''
) {
  message.textContent =
    text;

  message.className =
    `eq-message${type ? ` ${type}` : ''}`;
}

function populateRequiredSlots() {
  const select =
    document.getElementById('slot-id');

  select.innerHTML = `
    <option value="">
      Selecione um slot
    </option>
  `;

  for (const option of REQUIRED_SLOT_OPTIONS) {
    const match = meta.slots.find(item => {
      const slug = normalizeText(item.slug);
      const name = normalizeText(item.name);

      return option.slugs.some(candidate => {
        const normalized = normalizeText(candidate);
        return slug === normalized || name === normalized;
      });
    });

    if (!match) {
      console.warn(
        `[equipamento] Slot não encontrado para "${option.label}".`,
        option.slugs
      );
      continue;
    }

    const element = document.createElement('option');
    element.value = match.id;
    element.textContent = option.label;
    element.dataset.slug = match.slug || '';
    select.appendChild(element);
  }
}

function findMetaMatch(
  items,
  value
) {
  const wanted =
    normalizeText(value);

  if (!wanted) {
    return null;
  }

  return (
    items.find(item =>
      normalizeText(item.name) === wanted ||
      normalizeText(item.slug) === wanted
    ) ||
    items.find(item => {
      const name =
        normalizeText(item.name);

      const slug =
        normalizeText(item.slug);

      return (
        name.includes(wanted) ||
        wanted.includes(name) ||
        slug.includes(wanted) ||
        wanted.includes(slug)
      );
    }) ||
    null
  );
}

function addAttrRow(
  host,
  value = {
    label: '',
    value: '',
    unit: ''
  }
) {
  const row =
    document.createElement('div');

  row.className =
    'attr-row';

  row.innerHTML = `
    <input
      placeholder="Atributo"
      value="${escapeHtml(
        value.label ||
        value.raw ||
        ''
      )}"
    >

    <input
      placeholder="Valor"
      value="${escapeHtml(
        value.value ?? ''
      )}"
    >

    <button
      type="button"
      class="eq-btn danger"
    >
      ×
    </button>
  `;

  row
    .querySelector('button')
    .onclick =
      () => row.remove();

  host.appendChild(row);
}

function renderRarities(
  values = {}
) {
  rarityHost.innerHTML = '';

  for (
    const rarity
    of meta.rarities
  ) {
    const card =
      document.createElement(
        'article'
      );

    card.className =
      'rarity-card';

    card.dataset.rarityId =
      rarity.id;

    card.dataset.raritySlug =
      rarity.slug;

    card.innerHTML = `
      <div class="rarity-head">
        <span
          class="rarity-title"
          style="color:${rarity.color}"
        >
          ${escapeHtml(rarity.name)}
        </span>

        <button
          type="button"
          class="eq-btn"
        >
          Adicionar atributo
        </button>
      </div>

      <div class="attrs"></div>
    `;

    const attrs =
      card.querySelector(
        '.attrs'
      );

    const current =
      values[rarity.slug] ||
      [];

    if (!current.length) {
      addAttrRow(attrs);
    }

    current.forEach(
      item =>
        addAttrRow(
          attrs,
          item
        )
    );

    card
      .querySelector('button')
      .onclick =
        () => addAttrRow(attrs);

    rarityHost.appendChild(card);
  }
}

function addBonusRow(
  value = {
    required_pieces: 2,
    title: '',
    description: ''
  }
) {
  const row =
    document.createElement('div');

  row.className =
    'set-bonus-row';

  row.innerHTML = `
    <input
      type="number"
      min="1"
      value="${escapeHtml(
        value.required_pieces || 2
      )}"
    >

    <input
      placeholder="Título"
      value="${escapeHtml(
        value.title || ''
      )}"
    >

    <input
      placeholder="Descrição"
      value="${escapeHtml(
        value.description || ''
      )}"
    >

    <button
      type="button"
      class="eq-btn danger"
    >
      ×
    </button>
  `;

  row
    .querySelector('button')
    .onclick =
      () => row.remove();

  bonusHost.appendChild(row);
}

function collectCurrentFormState() {
  const variants = {};

  rarityHost
    .querySelectorAll(
      '.rarity-card'
    )
    .forEach(card => {
      const slug =
        card.dataset.raritySlug;

      if (!slug) {
        return;
      }

      variants[slug] = [
        ...card.querySelectorAll(
          '.attr-row'
        )
      ].map(row => {
        const inputs =
          row.querySelectorAll(
            'input'
          );

        return {
          label:
            inputs[0]?.value || '',

          value:
            inputs[1]?.value || ''
        };
      });
    });

  const bonuses = [
    ...bonusHost.querySelectorAll(
      '.set-bonus-row'
    )
  ].map(row => {
    const inputs =
      row.querySelectorAll(
        'input'
      );

    return {
      required_pieces:
        Number(
          inputs[0]?.value || 2
        ),

      title:
        inputs[1]?.value || '',

      description:
        inputs[2]?.value || ''
    };
  });

  return {
    name:
      document
        .getElementById('name')
        .value,

    slug:
      document
        .getElementById('slug')
        .value,

    slotId:
      document
        .getElementById('slot-id')
        .value,

    setId:
      document
        .getElementById('set-id')
        .value,

    newSetName:
      document
        .getElementById(
          'new-set-name'
        )
        .value,

    displayOrder:
      document
        .getElementById(
          'display-order'
        )
        .value,

    description:
      document
        .getElementById(
          'description'
        )
        .value,

    recommendation:
      document
        .getElementById(
          'recommendation'
        )
        .value,

    enabled:
      document
        .getElementById(
          'enabled'
        )
        .checked,

    previewHtml:
      document
        .getElementById(
          'preview-image'
        )
        .innerHTML,

    variants,
    bonuses
  };
}

function restoreFormState(
  state
) {
  if (!state) {
    return;
  }

  document
    .getElementById('name')
    .value =
      state.name || '';

  document
    .getElementById('slug')
    .value =
      state.slug || '';

  document
    .getElementById('slot-id')
    .value =
      state.slotId || '';

  document
    .getElementById('set-id')
    .value =
      state.setId || '';

  document
    .getElementById(
      'new-set-name'
    )
    .value =
      state.newSetName || '';

  document
    .getElementById(
      'display-order'
    )
    .value =
      state.displayOrder || 0;

  document
    .getElementById(
      'description'
    )
    .value =
      state.description || '';

  document
    .getElementById(
      'recommendation'
    )
    .value =
      state.recommendation || '';

  document
    .getElementById(
      'enabled'
    )
    .checked =
      state.enabled !== false;

  document
    .getElementById(
      'preview-image'
    )
    .innerHTML =
      state.previewHtml ||
      'Prévia da imagem';

  renderRarities(
    state.variants || {}
  );

  bonusHost.innerHTML = '';

  (
    state.bonuses || []
  ).forEach(
    addBonusRow
  );

  if (
    !state.bonuses?.length
  ) {
    addBonusRow();
  }
}

function saveImportBackup() {
  importBackup =
    collectCurrentFormState();

  sessionStorage.setItem(
    IMPORT_BACKUP_KEY,
    JSON.stringify(
      importBackup
    )
  );
}

function loadImportBackup() {
  try {
    const raw =
      sessionStorage.getItem(
        IMPORT_BACKUP_KEY
      );

    return raw
      ? JSON.parse(raw)
      : null;
  } catch {
    return null;
  }
}

function clearImportBackup() {
  importBackup = null;

  sessionStorage.removeItem(
    IMPORT_BACKUP_KEY
  );
}

function showImportSummary(
  data,
  {
    slotMatched = false,
    setMatched = false,
    warnings = []
  } = {}
) {
  const rarityCount =
    Object.values(
      data.variants || {}
    ).filter(
      list =>
        Array.isArray(list) &&
        list.length
    ).length;

  const attributeCount =
    Object.values(
      data.variants || {}
    ).reduce(
      (
        total,
        list
      ) =>
        total +
        (
          Array.isArray(list)
            ? list.length
            : 0
        ),
      0
    );

  document
    .getElementById(
      'import-rarity-count'
    )
    .textContent =
      String(rarityCount);

  document
    .getElementById(
      'import-attribute-count'
    )
    .textContent =
      String(attributeCount);

  document
    .getElementById(
      'import-bonus-count'
    )
    .textContent =
      String(
        data.bonuses?.length || 0
      );

  document
    .getElementById(
      'import-match-count'
    )
    .textContent =
      `${Number(slotMatched) + Number(setMatched)} / 2`;

  const warningHost =
    document.getElementById(
      'import-warnings'
    );

  warningHost.innerHTML =
    warnings.map(
      warning => `
        <div class="eq-import-warning">
          ${escapeHtml(warning)}
        </div>
      `
    ).join('');

  importSummary.classList.add(
    'is-visible'
  );

  importBanner.classList.add(
    'is-visible'
  );

  document
    .getElementById(
      'import-banner-text'
    )
    .textContent =
      `${rarityCount} raridade(s), ` +
      `${attributeCount} atributo(s) e ` +
      `${data.bonuses?.length || 0} bônus aplicados.`;
}

function fillFromDraft(
  data
) {
  if (!data) {
    return;
  }

  saveImportBackup();

  const warnings = [];

  document
    .getElementById('name')
    .value =
      data.name || '';

  document
    .getElementById('slug')
    .value =
      data.slug ||
      slugify(
        data.name || ''
      );

  document
    .getElementById(
      'description'
    )
    .value =
      data.description || '';

  document
    .getElementById(
      'recommendation'
    )
    .value =
      data.recommendation || '';

  document
    .getElementById(
      'display-order'
    )
    .value =
      Number.isFinite(
        Number(
          data.displayOrder
        )
      )
        ? String(
            Number(
              data.displayOrder
            )
          )
        : '0';

  document
    .getElementById(
      'enabled'
    )
    .checked =
      data.enabled !== false;

  let slotMatched = false;

  if (data.slot) {
    const slot =
      findMetaMatch(
        meta.slots,
        data.slot
      );

    if (slot) {
      document
        .getElementById(
          'slot-id'
        )
        .value =
          slot.id;

      slotMatched = true;
    } else {
      warnings.push(
        `Slot não encontrado: ${data.slot}.`
      );
    }
  }

  let setMatched = false;

  if (data.setName) {
    const set =
      findMetaMatch(
        meta.sets,
        data.setName
      );

    if (set) {
      document
        .getElementById(
          'set-id'
        )
        .value =
          set.id;

      document
        .getElementById(
          'new-set-name'
        )
        .value =
          '';

      setMatched = true;
    } else {
      document
        .getElementById(
          'new-set-name'
        )
        .value =
          data.setName;

      warnings.push(
        `Conjunto não encontrado. Será criado ao salvar: ${data.setName}.`
      );
    }
  }

  renderRarities(
    data.variants || {}
  );

  bonusHost.innerHTML = '';

  (
    data.bonuses || []
  ).forEach(
    addBonusRow
  );

  if (
    !data.bonuses?.length
  ) {
    addBonusRow();
  }

  importWasApplied = true;

  showImportSummary(
    data,
    {
      slotMatched,
      setMatched,
      warnings
    }
  );

  setMessage(
    'Importação aplicada. Revise os campos antes de salvar.',
    'ok'
  );
}

function fillExisting(bundle) {
  const equipment =
    bundle.equipment;

  document
    .getElementById(
      'page-title'
    )
    .textContent =
      'Editar equipamento';

  document
    .getElementById('name')
    .value =
      equipment.name || '';

  document
    .getElementById('slug')
    .value =
      equipment.slug || '';

  document
    .getElementById('slot-id')
    .value =
      equipment.slot_id || '';

  document
    .getElementById('set-id')
    .value =
      equipment.set_id || '';

  document
    .getElementById(
      'display-order'
    )
    .value =
      equipment.display_order || 0;

  document
    .getElementById(
      'description'
    )
    .value =
      equipment.description || '';

  document
    .getElementById(
      'recommendation'
    )
    .value =
      equipment.recommendation || '';

  document
    .getElementById(
      'enabled'
    )
    .checked =
      equipment.enabled !== false;

  if (equipment.image_path) {
    document
      .getElementById(
        'preview-image'
      )
      .innerHTML = `
        <img
          src="${publicMediaUrl(
            equipment.image_path
          )}"
          alt=""
        >
      `;
  }

  const variantMap = {};

  for (
    const variant
    of bundle.variants
  ) {
    variantMap[
      variant.equipment_rarities.slug
    ] =
      variant.attributes || [];
  }

  renderRarities(
    variantMap
  );

  bonusHost.innerHTML = '';

  bundle.bonuses.forEach(
    addBonusRow
  );

  if (!bundle.bonuses.length) {
    addBonusRow();
  }
}

document
  .getElementById('name')
  .oninput =
    event => {
      if (!equipmentId) {
        document
          .getElementById('slug')
          .value =
            slugify(
              event.target.value
            );
      }
    };

document
  .getElementById(
    'image-file'
  )
  .onchange =
    event => {
      const file =
        event.target.files?.[0];

      if (file) {
        document
          .getElementById(
            'preview-image'
          )
          .innerHTML = `
            <img
              src="${URL.createObjectURL(file)}"
              alt=""
            >
          `;
      }
    };

document
  .getElementById(
    'add-bonus'
  )
  .onclick =
    () => addBonusRow();

undoImportButton.addEventListener(
  'click',
  () => {
    const backup =
      importBackup ||
      loadImportBackup();

    if (!backup) {
      setMessage(
        'Nenhum backup de formulário foi encontrado.',
        'error'
      );

      return;
    }

    restoreFormState(
      backup
    );

    importWasApplied = false;

    importBanner.classList.remove(
      'is-visible'
    );

    importSummary.classList.remove(
      'is-visible'
    );

    clearImportBackup();

    sessionStorage.removeItem(
      IMPORT_KEY
    );

    setMessage(
      'O preenchimento importado foi desfeito.',
      'ok'
    );
  }
);

form.onsubmit =
  async event => {
    event.preventDefault();

    setMessage(
      'Salvando...'
    );

    try {
      const selectedSlotId =
        document
          .getElementById('slot-id')
          .value;

      if (!selectedSlotId) {
        throw new Error(
          'Selecione obrigatoriamente um slot: Cabeça, Peito, Mãos, Pés, Anel ou Gadget.'
        );
      }

      let setId =
        document
          .getElementById(
            'set-id'
          )
          .value ||
        null;

      const newSetName =
        document
          .getElementById(
            'new-set-name'
          )
          .value
          .trim();

      if (newSetName) {
        const set =
          await upsertSet({
            name:
              newSetName,

            slug:
              slugify(
                newSetName
              ),

            description:
              ''
          });

        setId =
          set.id;
      }

      const imageFile =
        document
          .getElementById(
            'image-file'
          )
          .files?.[0];

      const imagePath =
        imageFile
          ? await uploadEquipmentImage(
              imageFile
            )
          : currentBundle
              ?.equipment
              .image_path ||
            null;

      const variants = [
        ...rarityHost.querySelectorAll(
          '.rarity-card'
        )
      ].map(card => ({
        rarity_id:
          card.dataset.rarityId,

        attributes: [
          ...card.querySelectorAll(
            '.attr-row'
          )
        ].map(row => {
          const inputs =
            row.querySelectorAll(
              'input'
            );

          return {
            label:
              inputs[0]
                .value
                .trim(),

            value:
              inputs[1]
                .value
                .trim()
          };
        }).filter(
          item =>
            item.label
        )
      }));

      const bonuses = [
        ...bonusHost.querySelectorAll(
          '.set-bonus-row'
        )
      ].map(
        (
          row,
          index
        ) => {
          const inputs =
            row.querySelectorAll(
              'input'
            );

          return {
            required_pieces:
              Number(
                inputs[0]
                  .value
              ),

            title:
              inputs[1]
                .value
                .trim(),

            description:
              inputs[2]
                .value
                .trim(),

            attributes:
              [],

            display_order:
              index + 1
          };
        }
      ).filter(
        item =>
          item.title &&
          item.description
      );

      const savedEquipment =
        await saveEquipmentBundle({
          equipmentId,

          equipment: {
            name:
              document
                .getElementById(
                  'name'
                )
                .value
                .trim(),

            slug:
              document
                .getElementById(
                  'slug'
                )
                .value
                .trim(),

            slot_id:
              selectedSlotId,

            set_id:
              setId,

            description:
              document
                .getElementById(
                  'description'
                )
                .value
                .trim(),

            recommendation:
              document
                .getElementById(
                  'recommendation'
                )
                .value
                .trim(),

            image_path:
              imagePath,

            enabled:
              document
                .getElementById(
                  'enabled'
                )
                .checked,

            display_order:
              Number(
                document
                  .getElementById(
                    'display-order'
                  )
                  .value ||
                0
              )
          },

          variants,
          bonuses
        });

      sessionStorage.removeItem(
        IMPORT_KEY
      );

      clearImportBackup();

      const wasUpdated =
        savedEquipment?.operation ===
        'updated';

      setMessage(
        wasUpdated
          ? 'Equipamento existente atualizado com sucesso.'
          : 'Equipamento criado com sucesso.',
        'ok'
      );

      setTimeout(
        () => {
          if (savedEquipment?.id) {
            location.href =
              `./equipment-editor.html?id=${encodeURIComponent(
                savedEquipment.id
              )}`;
            return;
          }

          location.href =
            './equipments.html';
        },
        700
      );
    } catch (error) {
      setMessage(
        error.message ||
        'Não foi possível salvar o equipamento.',
        'error'
      );
    }
  };

meta =
  await loadEquipmentMeta();

populateRequiredSlots();

document
  .getElementById(
    'set-id'
  )
  .innerHTML +=
    meta.sets.map(
      item => `
        <option value="${item.id}">
          ${escapeHtml(item.name)}
        </option>
      `
    ).join('');

renderRarities();
addBonusRow();

if (equipmentId) {
  currentBundle =
    await getEquipmentBundle(
      equipmentId
    );

  fillExisting(
    currentBundle
  );
}

if (draft) {
  fillFromDraft(
    draft
  );
}

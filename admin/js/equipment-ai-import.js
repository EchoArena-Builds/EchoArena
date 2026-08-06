import {
  requireAdmin,
  logoutAdmin
} from './admin-auth.js';

import {
  loadEquipmentMeta,
  getEquipmentBySlug,
  getEquipmentBundle,
  saveEquipmentBundle,
  upsertSet
} from './equipment-api.js';

await requireAdmin();

const logoutButton =
  document.getElementById('logout');

if (logoutButton) {
  logoutButton.onclick =
    logoutAdmin;
}

const REQUIRED_SLOT_OPTIONS = [
  {
    label: 'Cabeça',
    slugs: ['cabeca']
  },
  {
    label: 'Peito',
    slugs: ['body', 'peito', 'corpo']
  },
  {
    label: 'Mãos',
    slugs: ['maos', 'hands']
  },
  {
    label: 'Pés',
    slugs: ['leg', 'pes', 'perna']
  },
  {
    label: 'Anel',
    slugs: ['ring', 'anel']
  },
  {
    label: 'Gadget',
    slugs: ['especial', 'gadget']
  }
];

const RARITIES = [
  ['comum', 'Comum'],
  ['raro', 'Raro'],
  ['epico', 'Épico'],
  ['lendario', 'Lendário'],
  ['mitico', 'Mítico'],
  ['supremo', 'Supremo'],
  ['grandioso', 'Grandioso'],
  ['celestial', 'Celestial'],
  ['estelar', 'Estelar'],
  ['imortal', 'Imortal'],
  ['divino', 'Divino']
];

const jsonArea =
  document.getElementById(
    'equipment-ai-json'
  );

const slotSelect =
  document.getElementById(
    'equipment-ai-slot'
  );

const validateButton =
  document.getElementById(
    'equipment-ai-validate'
  );

const saveButton =
  document.getElementById(
    'equipment-ai-save'
  );

const clearButton =
  document.getElementById(
    'equipment-ai-clear'
  );

const newButton =
  document.getElementById(
    'equipment-ai-new'
  );

const statusBox =
  document.getElementById(
    'equipment-ai-status'
  );

const successActions =
  document.getElementById(
    'equipment-ai-success-actions'
  );

const editLink =
  document.getElementById(
    'equipment-ai-edit-link'
  );

let meta = null;
let validatedDraft = null;
let isSaving = false;
let pendingUpdate = null;

function ensureFlowUi() {
  if (document.getElementById('equipment-flow-style')) return;

  const style = document.createElement('style');
  style.id = 'equipment-flow-style';
  style.textContent = `
    .equipment-flow-overlay{position:fixed;inset:0;z-index:12000;background:rgba(1,7,18,.94);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:24px;overflow:auto;color:#f8fafc}
    .equipment-flow-overlay.is-visible{display:flex}
    .equipment-flow-card{width:min(1120px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#071223;border:1px solid #263751;border-radius:24px;box-shadow:0 30px 90px #000a}
    .equipment-flow-card.success{width:min(680px,100%);border-color:#1c9b68;text-align:center;position:relative;overflow:hidden}
    .equipment-flow-card.success:before{content:'';display:block;height:4px;background:#35df8d}
    .equipment-flow-head,.equipment-flow-body,.equipment-flow-foot{padding:26px 30px}
    .equipment-flow-head{border-bottom:1px solid #24324a}.equipment-flow-foot{border-top:1px solid #24324a;display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;position:sticky;bottom:0;background:#071223}
    .equipment-flow-kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#f2c75c;font-weight:900}.equipment-flow-title{font-size:30px;margin:8px 0}.equipment-flow-muted{color:#aab6ca}
    .equipment-flow-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:20px 0}.equipment-flow-stat,.equipment-flow-side,.equipment-flow-diff,.equipment-flow-name{border:1px solid #263751;background:#0a1628;border-radius:14px;padding:16px}.equipment-flow-stat strong{font-size:25px;display:block}.equipment-flow-stat small{color:#99a7bc;text-transform:uppercase}
    .equipment-flow-compare{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}.equipment-flow-side small{color:#8998af;font-weight:800}.equipment-flow-side strong{display:block;font-size:20px;margin-top:8px}
    .equipment-flow-group{margin-top:18px}.equipment-flow-group h3{font-size:13px;letter-spacing:.12em;color:#94a3b8}.equipment-flow-diff{display:grid;grid-template-columns:auto minmax(140px,.6fr) minmax(0,1.4fr);gap:12px;margin:8px 0;align-items:center}.equipment-flow-diff.is-equal{opacity:.56}.equipment-flow-status{display:block;margin-top:4px;color:#8b9ab0;font-size:10px}.equipment-flow-values{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;color:#aebad0;font-size:12px;word-break:break-word}.equipment-flow-values span,.equipment-flow-values b{padding:9px;border-radius:8px;background:#07101d}.equipment-flow-values b{color:#f8fafc}.equipment-flow-empty{text-align:center;padding:42px;color:#aab6ca}.equipment-flow-foot-info{margin-right:auto;color:#aab6ca;font-size:11px;line-height:1.7}
    .equipment-flow-check{width:18px;height:18px;accent-color:#8b5cf6}.equipment-flow-btn{border:1px solid #30415e;background:#101c31;color:#fff;border-radius:12px;padding:13px 18px;font-weight:800;cursor:pointer}.equipment-flow-btn.primary{border:0;background:linear-gradient(135deg,#9857f7,#6d28d9)}.equipment-flow-btn:disabled{opacity:.38;cursor:not-allowed}
    .equipment-flow-checkmark{width:96px;height:96px;margin:14px auto 20px;border:2px solid #35df8d;border-radius:50%;display:grid;place-items:center;color:#6ff0ad;font-size:58px;box-shadow:0 0 0 12px #35df8d0d}.equipment-flow-success-kicker{color:#79edae;font-weight:900;letter-spacing:.14em;font-size:12px}.equipment-flow-name{font-size:22px;font-weight:900;margin:22px 0}.equipment-flow-details{display:grid;grid-template-columns:1fr 1fr;gap:10px}.equipment-flow-details div{border:1px solid #263751;border-radius:12px;padding:13px;color:#b7c2d4}
    @media(max-width:700px){.equipment-flow-overlay{padding:10px;align-items:flex-start}.equipment-flow-card{max-height:none}.equipment-flow-head,.equipment-flow-body,.equipment-flow-foot{padding:18px}.equipment-flow-summary{grid-template-columns:1fr 1fr}.equipment-flow-compare,.equipment-flow-details,.equipment-flow-diff,.equipment-flow-values{grid-template-columns:1fr}.equipment-flow-title{font-size:24px}.equipment-flow-foot .equipment-flow-btn{flex:1}.equipment-flow-foot-info{width:100%}}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'equipment-flow-overlay';
  overlay.className = 'equipment-flow-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  document.body.appendChild(overlay);
}

function closeFlow() {
  const overlay = document.getElementById('equipment-flow-overlay');
  if (overlay) {
    overlay.classList.remove('is-visible');
    overlay.innerHTML = '';
  }
  pendingUpdate = null;
}

function stableValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return JSON.stringify(value.map(item =>
    item && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  ));
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function shortValue(value) {
  const text = stableValue(value);
  if (!text) return '—';
  return text.length > 150 ? `${text.slice(0, 147)}…` : text;
}

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

function nullableNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const normalized =
    typeof value === 'string'
      ? value.replace(',', '.').trim()
      : value;

  const number =
    Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}

function extractJson(value = '') {
  const text =
    String(value).trim();

  if (!text) {
    throw new Error(
      'Cole o JSON retornado pelo ChatGPT.'
    );
  }

  const fenced =
    text.match(
      /```(?:json)?\s*([\s\S]*?)```/i
    );

  const candidate =
    fenced
      ? fenced[1].trim()
      : text;

  const firstBrace =
    candidate.indexOf('{');

  const lastBrace =
    candidate.lastIndexOf('}');

  if (
    firstBrace < 0 ||
    lastBrace < firstBrace
  ) {
    throw new Error(
      'Não foi encontrado um objeto JSON.'
    );
  }

  return candidate.slice(
    firstBrace,
    lastBrace + 1
  );
}

function normalizeAttribute(attribute) {
  if (
    !attribute ||
    typeof attribute !== 'object'
  ) {
    return null;
  }

  const label =
    String(
      attribute.label ??
      attribute.name ??
      attribute.raw ??
      ''
    ).trim();

  const raw =
    String(
      attribute.raw ??
      ''
    ).trim();

  if (!label && !raw) {
    return null;
  }

  const value =
    attribute.value ??
    '';

  return {
    label:
      label || raw,
    value:
      String(value).trim()
  };
}

function humanizeKey(value = '') {
  const labels = {
    dispersao_de_tiro_da_arma_sem_mirar:
      'Dispersão de tiro da arma sem mirar',
    velocidade_para_pegar_melhorias:
      'Velocidade para pegar melhorias',
    barulho_da_movimentacao_do_heroi_apos_usar_habilidade_bandagem:
      'Barulho da movimentação do herói após usar a habilidade Bandagem',
    tempo_de_recarregamento_da_arma_do_heroi:
      'Tempo de recarregamento da arma do herói',
    tempo_de_abertura_de_caixa:
      'Tempo de abertura de caixa',
    duracao_da_habilidade_visao_termica:
      'Duração da habilidade Visão Térmica',
    restauracao_de_vida_com_habilidade_bandagem_ativada:
      'Restauração de vida com a habilidade Bandagem ativada',
    tempo_de_mira_da_arma:
      'Tempo de mira da arma',
    poder_de_perfuracao_da_arma_com_habilidade_visao_termica_ativada:
      'Poder de perfuração da arma com Visão Térmica ativada'
  };

  if (labels[value]) {
    return labels[value];
  }

  const text = String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : '';
}

function normalizeRarityAttributes(source) {
  if (Array.isArray(source)) {
    return source
      .map(normalizeAttribute)
      .filter(Boolean);
  }

  if (
    !source ||
    typeof source !== 'object'
  ) {
    return [];
  }

  return Object.entries(source)
    .map(([key, value]) =>
      normalizeAttribute({
        label: humanizeKey(key),
        value,
        raw: `${value} ${humanizeKey(key)}`
      })
    )
    .filter(Boolean);
}

function normalizeBonus(bonus) {
  if (
    !bonus ||
    typeof bonus !== 'object'
  ) {
    return null;
  }

  const requiredPieces =
    nullableNumber(
      bonus.required_pieces ??
      bonus.requiredPieces
    ) || 2;

  const title =
    String(
      bonus.title ??
      `${requiredPieces} Equipamentos`
    ).trim();

  const description =
    String(
      bonus.description ??
      ''
    ).trim();

  if (!title || !description) {
    return null;
  }

  return {
    required_pieces:
      requiredPieces,
    title,
    description
  };
}

function formatBonusEffect(effect) {
  if (
    !effect ||
    typeof effect !== 'object'
  ) {
    return '';
  }

  const label = humanizeKey(
    effect.atributo ??
    effect.attribute ??
    effect.label ??
    effect.name ??
    ''
  );

  const value =
    effect.valor ??
    effect.value ??
    null;

  const unit = String(
    effect.unidade ??
    effect.unit ??
    ''
  ).trim();

  if (!label) return '';

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return label;
  }

  const suffix =
    unit === '%'
      ? '%'
      : unit
        ? ` ${unit}`
        : '';

  return `${value}${suffix} — ${label}`;
}

function normalizeGroupedBonuses(source) {
  if (
    !source ||
    typeof source !== 'object' ||
    Array.isArray(source)
  ) {
    return [];
  }

  return Object.entries(source)
    .map(([key, effects]) => {
      const requiredPieces =
        nullableNumber(
          String(key).match(/\d+/)?.[0]
        );

      const descriptions =
        Array.isArray(effects)
          ? effects
              .map(formatBonusEffect)
              .filter(Boolean)
          : [];

      if (
        !requiredPieces ||
        !descriptions.length
      ) {
        return null;
      }

      return normalizeBonus({
        required_pieces:
          requiredPieces,
        title:
          `${requiredPieces} Equipamentos`,
        description:
          descriptions.join('\n')
      });
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.required_pieces -
        b.required_pieces
    );
}

function normalizeData(source = {}) {
  if (
    !source ||
    typeof source !== 'object' ||
    Array.isArray(source)
  ) {
    throw new Error(
      'O conteúdo principal precisa ser um objeto JSON.'
    );
  }

  const equipment =
    source.equipment &&
    typeof source.equipment === 'object'
      ? source.equipment
      : source.equipamento &&
        typeof source.equipamento === 'object'
        ? source.equipamento
      : source;

  const sourceVariants =
    source.variants &&
    typeof source.variants === 'object'
      ? source.variants
      : equipment.efeitosPorCategoria &&
        typeof equipment.efeitosPorCategoria === 'object'
        ? equipment.efeitosPorCategoria
      : source.efeitosPorCategoria &&
        typeof source.efeitosPorCategoria === 'object'
        ? source.efeitosPorCategoria
      : {};

  const variants = {};

  for (const [slug] of RARITIES) {
    variants[slug] =
      normalizeRarityAttributes(
        sourceVariants[slug]
      );
  }

  const groupedBonuses =
    source.bonusDoConjunto ??
    source.bonus_do_conjunto ??
    equipment.bonusDoConjunto ??
    equipment.bonus_do_conjunto ??
    null;

  return {
    name:
      String(
        equipment.name ??
        equipment.nome ??
        source.name ??
        source.nome ??
        ''
      ).trim(),

    slug:
      String(
        equipment.slug ??
        source.slug ??
        ''
      ).trim(),

    setName:
      String(
        equipment.setName ??
        equipment.set_name ??
        equipment.conjunto ??
        source.setName ??
        source.set_name ??
        source.conjunto ??
        ''
      ).trim(),

    description:
      String(
        equipment.description ??
        equipment.descricao ??
        source.description ??
        source.descricao ??
        ''
      ).trim(),

    recommendation:
      String(
        equipment.recommendation ??
        equipment.recomendacao ??
        source.recommendation ??
        source.recomendacao ??
        ''
      ).trim(),

    displayOrder:
      nullableNumber(
        equipment.displayOrder ??
        equipment.display_order ??
        source.displayOrder ??
        source.display_order
      ),

    enabled:
      equipment.enabled ??
      source.enabled ??
      true,

    variants,

    bonuses:
      Array.isArray(
        source.bonuses
      )
        ? source.bonuses
            .map(
              normalizeBonus
            )
            .filter(Boolean)
        : normalizeGroupedBonuses(
            groupedBonuses
          )
  };
}

function showStatus(
  text,
  type = ''
) {
  statusBox.textContent =
    text;

  statusBox.className =
    `equipment-ai-status is-visible ${type}`.trim();
}

function populateSlots() {
  slotSelect.innerHTML = `
    <option value="">
      Selecione um slot
    </option>
  `;

  for (
    const option
    of REQUIRED_SLOT_OPTIONS
  ) {
    const match =
      meta.slots.find(item => {
        const itemSlug =
          normalizeText(
            item.slug
          );

        const itemName =
          normalizeText(
            item.name
          );

        return option.slugs.some(
          candidate => {
            const normalized =
              normalizeText(
                candidate
              );

            return (
              itemSlug === normalized ||
              itemName === normalized
            );
          }
        );
      });

    if (!match) {
      console.warn(
        `[equipamento] Slot não encontrado para "${option.label}".`
      );
      continue;
    }

    const element =
      document.createElement(
        'option'
      );

    element.value =
      match.id;

    element.textContent =
      option.label;

    element.dataset.slug =
      match.slug || '';

    slotSelect.appendChild(
      element
    );
  }
}

function findSet(value) {
  const wanted =
    normalizeText(value);

  if (!wanted) {
    return null;
  }

  return (
    meta.sets.find(item =>
      normalizeText(item.name) === wanted ||
      normalizeText(item.slug) === wanted
    ) ||
    null
  );
}

function countDraft() {
  const rarityCount =
    Object.values(
      validatedDraft?.variants || {}
    ).filter(
      list =>
        Array.isArray(list) &&
        list.length
    ).length;

  const attributeCount =
    Object.values(
      validatedDraft?.variants || {}
    ).reduce(
      (total, list) =>
        total +
        (
          Array.isArray(list)
            ? list.length
            : 0
        ),
      0
    );

  return {
    rarityCount,
    attributeCount
  };
}

function updateSaveState() {
  saveButton.disabled =
    !validatedDraft ||
    !slotSelect.value ||
    isSaving;
}

function renderReview(draft) {
  const warnings = [];

  if (!draft.name) {
    warnings.push(
      'O nome do equipamento não foi informado.'
    );
  }

  if (!draft.setName) {
    warnings.push(
      'O conjunto não foi informado.'
    );
  }

  let rarityCount = 0;
  let attributeCount = 0;
  const rarityBlocks = [];

  for (
    const [slug, label]
    of RARITIES
  ) {
    const attributes =
      draft.variants[slug] || [];

    if (!attributes.length) {
      continue;
    }

    rarityCount += 1;
    attributeCount +=
      attributes.length;

    rarityBlocks.push(`
      <article class="equipment-ai-rarity">
        <div class="equipment-ai-rarity-head">
          <strong>
            ${escapeHtml(label)}
          </strong>

          <span>
            ${attributes.length} atributo(s)
          </span>
        </div>
      </article>
    `);
  }

  document
    .getElementById(
      'review-name'
    )
    .textContent =
      draft.name ||
      'Sem nome';

  document
    .getElementById(
      'review-set'
    )
    .textContent =
      draft.setName ||
      'Não informado';

  document
    .getElementById(
      'review-rarities'
    )
    .textContent =
      String(rarityCount);

  document
    .getElementById(
      'review-attributes'
    )
    .textContent =
      String(attributeCount);

  document
    .getElementById(
      'review-rarity-list'
    )
    .innerHTML =
      rarityBlocks.join('');

  document
    .getElementById(
      'review-warnings'
    )
    .innerHTML =
      warnings.map(
        warning => `
          <div class="equipment-ai-warning">
            ${escapeHtml(warning)}
          </div>
        `
      ).join('');

  slotSelect.disabled =
    !draft.name;

  updateSaveState();

  showStatus(
    warnings.length
      ? `JSON válido com ${warnings.length} aviso(s). Escolha o slot para salvar.`
      : 'JSON válido. Escolha o slot para liberar o salvamento.',
    warnings.length
      ? 'warn'
      : 'ok'
  );
}

function buildVariants() {
  return meta.rarities.map(
    rarity => ({
      rarity_id:
        rarity.id,

      attributes:
        validatedDraft
          .variants[
            rarity.slug
          ] || []
    })
  );
}

async function resolveSetId() {
  if (!validatedDraft.setName) {
    return null;
  }

  const existingSet =
    findSet(
      validatedDraft.setName
    );

  if (existingSet) {
    return existingSet.id;
  }

  const createdSet =
    await upsertSet({
      name:
        validatedDraft.setName,
      slug:
        slugify(
          validatedDraft.setName
        ),
      description:
        ''
    });

  meta.sets.push(
    createdSet
  );

  return createdSet.id;
}

function incomingBonuses() {
  return validatedDraft.bonuses.map((bonus, index) => ({
    ...bonus,
    display_order: index + 1
  }));
}

function buildUpdateDiff(bundle) {
  const equipment = bundle.equipment;
  const currentSet = meta.sets.find(item => item.id === equipment.set_id);
  const currentSlot = meta.slots.find(item => item.id === equipment.slot_id);
  const incomingSlot = meta.slots.find(item => item.id === slotSelect.value);
  const fields = [
    ['name', 'Nome', equipment.name, validatedDraft.name],
    ['slot_id', 'Slot', currentSlot?.name || equipment.slot_id, incomingSlot?.name || slotSelect.value],
    ['set_id', 'Conjunto', currentSet?.name || 'Sem conjunto', validatedDraft.setName || currentSet?.name || 'Sem conjunto'],
    ['description', 'Descrição', equipment.description, validatedDraft.description || equipment.description],
    ['recommendation', 'Recomendação', equipment.recommendation, validatedDraft.recommendation || equipment.recommendation],
    ['enabled', 'Ativo', equipment.enabled !== false, validatedDraft.enabled !== false],
    ['display_order', 'Ordem', equipment.display_order ?? 0, validatedDraft.displayOrder ?? equipment.display_order ?? 0],
    ['image_path', 'Imagem', equipment.image_path || 'Sem imagem', equipment.image_path || 'Sem imagem']
  ].map(([key, label, before, after]) => ({key, label, before, after, group: 'Geral'}));

  const oldVariants = new Map(bundle.variants.map(row => [row.equipment_rarities?.slug, row.attributes || []]));
  for (const rarity of meta.rarities) {
    const oldAttributes = oldVariants.get(rarity.slug) || [];
    const newAttributes = validatedDraft.variants[rarity.slug] || [];
    const oldMap = new Map(oldAttributes.map(item => [normalizeText(item.label), item]));

    for (const attribute of newAttributes) {
      const oldAttribute = oldMap.get(normalizeText(attribute.label));
      fields.push({
        key: `rarity:${rarity.slug}:${slugify(attribute.label)}`,
        label: attribute.label,
        before: oldAttribute?.value ?? 'Não cadastrado',
        after: attribute.value,
        group: `Raridade · ${rarity.name || rarity.slug}`,
        raritySlug: rarity.slug,
        attribute
      });
    }
  }

  const oldBonuses = new Map(bundle.bonuses.map(item => [Number(item.required_pieces), item]));
  for (const bonus of incomingBonuses()) {
    const old = oldBonuses.get(Number(bonus.required_pieces));
    fields.push({
      key: `bonus:${bonus.required_pieces}`,
      label: `${bonus.required_pieces} equipamentos`,
      before: old ? {title: old.title, description: old.description} : null,
      after: {title: bonus.title, description: bonus.description},
      group: 'Bônus do conjunto'
    });
  }

  return fields.map(item => {
    const changed = stableValue(item.before) !== stableValue(item.after);
    const beforeNumber = nullableNumber(item.before);
    const afterNumber = nullableNumber(item.after);
    const kind = !changed
      ? 'equal'
      : beforeNumber !== null && afterNumber !== null
        ? afterNumber > beforeNumber ? 'increase' : 'decrease'
        : 'text';
    return {...item, changed, kind};
  });
}

function renderUpdateAssistant(existing, bundle) {
  ensureFlowUi();
  const diff = buildUpdateDiff(bundle);
  const changed = diff.filter(item => item.changed);
  const equal = diff.length - changed.length;
  pendingUpdate = {existing, bundle, diff};
  const groups = [...new Set(diff.map(item => item.group))];
  const content = groups.map(group => {
    const items = diff.filter(item => item.group === group);
    if (!items.length) return '';
    const groupChanges = items.filter(item => item.changed).length;
    return `<section class="equipment-flow-group"><h3>${escapeHtml(group)} · ${groupChanges ? `${groupChanges} alteração(ões)` : 'sem alterações'}</h3>${items.map(item => `
      <label class="equipment-flow-diff ${item.changed ? '' : 'is-equal'}">
        <input class="equipment-flow-check" type="checkbox" data-diff-key="${escapeHtml(item.key)}" ${item.changed ? 'checked' : 'disabled'}>
        <span><b>${escapeHtml(item.label)}</b><small class="equipment-flow-status">${item.kind === 'increase' ? '▲ Aumento' : item.kind === 'decrease' ? '▼ Redução' : item.kind === 'text' ? '⚠ Texto modificado' : '✓ Sem alteração'}</small></span>
        <span class="equipment-flow-values"><span>${escapeHtml(shortValue(item.before))}</span><i>→</i><b>${escapeHtml(shortValue(item.after))}</b></span>
      </label>`).join('')}</section>`;
  }).join('');

  const overlay = document.getElementById('equipment-flow-overlay');
  overlay.innerHTML = `<div class="equipment-flow-card">
    <div class="equipment-flow-head"><div class="equipment-flow-kicker">⚠ Equipamento já cadastrado</div><h2 class="equipment-flow-title">Revisar atualização</h2><div class="equipment-flow-muted">Encontramos um equipamento existente. Revise as alterações antes de atualizar.</div></div>
    <div class="equipment-flow-body">
      <div class="equipment-flow-summary"><div class="equipment-flow-stat"><strong>${changed.length}</strong><small>alterações</small></div><div class="equipment-flow-stat"><strong>${diff.filter(i => i.kind === 'increase').length}</strong><small>aumentos</small></div><div class="equipment-flow-stat"><strong>${diff.filter(i => i.kind === 'decrease').length}</strong><small>reduções</small></div><div class="equipment-flow-stat"><strong>${diff.filter(i => i.kind === 'text').length}</strong><small>textos modificados</small></div><div class="equipment-flow-stat"><strong>${equal}</strong><small>campos iguais</small></div></div>
      <div class="equipment-flow-compare"><div class="equipment-flow-side"><small>EQUIPAMENTO CADASTRADO</small><strong>${escapeHtml(existing.name)}</strong><span class="equipment-flow-muted">Dados atuais</span></div><div class="equipment-flow-side"><small>NOVO JSON</small><strong>${escapeHtml(validatedDraft.name)}</strong><span class="equipment-flow-muted">Importado agora</span></div></div>
      ${content}${changed.length ? '' : '<div class="equipment-flow-empty"><b>Nenhuma alteração encontrada</b><br>Os dados importados são idênticos aos já cadastrados. Nada será atualizado.</div>'}
    </div>
    <div class="equipment-flow-foot"><div class="equipment-flow-foot-info"><b data-selected-count>${changed.length} campos selecionados</b><br>${equal} preservados · 0 apagados</div><button class="equipment-flow-btn" data-flow="cancel">Cancelar · voltar ao editor</button><button class="equipment-flow-btn" data-flow="discard">Descartar importação</button><button class="equipment-flow-btn" data-flow="all" ${changed.length ? '' : 'disabled'}>Atualizar TODOS</button><button class="equipment-flow-btn primary" data-flow="selected" ${changed.length ? '' : 'disabled'}>Atualizar campos selecionados</button></div>
  </div>`;
  overlay.classList.add('is-visible');
  overlay.querySelector('[data-flow="cancel"]').onclick = closeFlow;
  overlay.querySelector('[data-flow="discard"]').onclick = () => { closeFlow(); clearAll(); };
  const confirmUpdate = async keys => {
    const buttons = [...overlay.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      await performSave(existing, keys);
    } catch (error) {
      console.error('Erro ao atualizar equipamento:', error);
      buttons.forEach(button => { button.disabled = false; });
      showStatus(error.message || 'Não foi possível atualizar o equipamento.', 'error');
      window.alert(error.message || 'Não foi possível atualizar o equipamento.');
    }
  };
  overlay.querySelector('[data-flow="all"]').onclick = () => confirmUpdate(diff.filter(i => i.changed).map(i => i.key));
  overlay.querySelector('[data-flow="selected"]').onclick = () => {
    const keys = [...overlay.querySelectorAll('[data-diff-key]:checked')].map(input => input.dataset.diffKey);
    if (keys.length) confirmUpdate(keys);
  };
  overlay.querySelectorAll('[data-diff-key]').forEach(input => input.addEventListener('change', () => {
    const count = overlay.querySelectorAll('[data-diff-key]:checked').length;
    overlay.querySelector('[data-selected-count]').textContent = `${count} campos selecionados`;
    overlay.querySelector('[data-flow="selected"]').disabled = count === 0;
  }));
}

function formatReviewAttribute(attribute) {
  const label = attribute?.label || 'Atributo';
  const value = attribute?.value;
  return `<div class="equipment-flow-diff"><span>✓</span><span><b>${escapeHtml(label)}</b><span class="equipment-flow-values"><b>${escapeHtml(value === '' || value === null || value === undefined ? '—' : value)}</b></span></span></div>`;
}

function renderCreateAssistant() {
  ensureFlowUi();

  const {rarityCount, attributeCount} = countDraft();
  const slotName = slotSelect.options[slotSelect.selectedIndex]?.textContent?.trim() || 'Não selecionado';
  const bonuses = incomingBonuses();
  const raritySections = meta.rarities.map(rarity => {
    const attributes = validatedDraft.variants[rarity.slug] || [];
    if (!attributes.length) return '';
    return `<section class="equipment-flow-group">
      <h3>${escapeHtml(rarity.name || rarity.slug)} · ${attributes.length} atributo(s)</h3>
      ${attributes.map(formatReviewAttribute).join('')}
    </section>`;
  }).join('');
  const bonusSection = bonuses.length
    ? `<section class="equipment-flow-group"><h3>BÔNUS DO CONJUNTO</h3>${bonuses.map(bonus => `
        <div class="equipment-flow-diff"><span>✓</span><span><b>${escapeHtml(bonus.required_pieces)} equipamentos</b><span class="equipment-flow-values">${escapeHtml(bonus.description)}</span></span></div>
      `).join('')}</section>`
    : '';

  const overlay = document.getElementById('equipment-flow-overlay');
  overlay.innerHTML = `<div class="equipment-flow-card">
    <div class="equipment-flow-head">
      <div class="equipment-flow-kicker" style="color:#79edae">✓ NOVO EQUIPAMENTO</div>
      <h2 class="equipment-flow-title">Revisar antes de cadastrar</h2>
      <div class="equipment-flow-muted">Confira os dados importados. O equipamento só será criado após sua confirmação.</div>
    </div>
    <div class="equipment-flow-body">
      <div class="equipment-flow-summary">
        <div class="equipment-flow-stat"><strong>${rarityCount}</strong><small>raridades</small></div>
        <div class="equipment-flow-stat"><strong>${attributeCount}</strong><small>atributos</small></div>
        <div class="equipment-flow-stat"><strong>${bonuses.length}</strong><small>bônus</small></div>
        <div class="equipment-flow-stat"><strong>0</strong><small>dados apagados</small></div>
      </div>
      <div class="equipment-flow-compare">
        <div class="equipment-flow-side"><small>EQUIPAMENTO</small><strong>${escapeHtml(validatedDraft.name)}</strong><span class="equipment-flow-muted">Novo cadastro</span></div>
        <div class="equipment-flow-side"><small>CLASSIFICAÇÃO</small><strong>${escapeHtml(slotName)}</strong><span class="equipment-flow-muted">${escapeHtml(validatedDraft.setName || 'Sem conjunto')}</span></div>
      </div>
      <section class="equipment-flow-group"><h3>INFORMAÇÕES GERAIS</h3>
        <div class="equipment-flow-diff"><span>✓</span><span><b>Nome</b><span class="equipment-flow-values">${escapeHtml(validatedDraft.name)}</span></span></div>
        <div class="equipment-flow-diff"><span>✓</span><span><b>Slug</b><span class="equipment-flow-values">${escapeHtml(validatedDraft.slug || slugify(validatedDraft.name))}</span></span></div>
        <div class="equipment-flow-diff"><span>✓</span><span><b>Slot</b><span class="equipment-flow-values">${escapeHtml(slotName)}</span></span></div>
        <div class="equipment-flow-diff"><span>✓</span><span><b>Conjunto</b><span class="equipment-flow-values">${escapeHtml(validatedDraft.setName || 'Sem conjunto')}</span></span></div>
      </section>
      <section class="equipment-flow-group"><h3>RARIDADES E ATRIBUTOS</h3>${raritySections || '<div class="equipment-flow-empty">Nenhum atributo informado.</div>'}</section>
      ${bonusSection}
    </div>
    <div class="equipment-flow-foot">
      <button class="equipment-flow-btn" data-create-flow="cancel">Cancelar · voltar ao editor</button>
      <button class="equipment-flow-btn" data-create-flow="discard">Descartar importação</button>
      <button class="equipment-flow-btn primary" data-create-flow="confirm">Confirmar e salvar equipamento</button>
    </div>
  </div>`;
  overlay.classList.add('is-visible');
  overlay.querySelector('[data-create-flow="cancel"]').onclick = closeFlow;
  overlay.querySelector('[data-create-flow="discard"]').onclick = () => { closeFlow(); clearAll(); };
  overlay.querySelector('[data-create-flow="confirm"]').onclick = async () => {
    const buttons = [...overlay.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      await performSave();
    } catch (error) {
      console.error('Erro ao criar equipamento:', error);
      buttons.forEach(button => { button.disabled = false; });
      showStatus(error.message || 'Não foi possível criar o equipamento.', 'error');
      window.alert(error.message || 'Não foi possível criar o equipamento.');
    }
  };
}

function showSuccess(saved, selectedCount = 0) {
  ensureFlowUi();
  const created = saved.operation === 'created';
  const attributeCount = Object.values(validatedDraft.variants).reduce((sum, attributes) => sum + attributes.length, 0);
  const overlay = document.getElementById('equipment-flow-overlay');
  overlay.innerHTML = `<div class="equipment-flow-card success"><div class="equipment-flow-body">
    <div class="equipment-flow-checkmark">✓</div><div class="equipment-flow-success-kicker">${created ? 'CADASTRO CONCLUÍDO' : 'ATUALIZAÇÃO CONCLUÍDA'}</div>
    <h2 class="equipment-flow-title">Equipamento ${created ? 'salvo' : 'atualizado'} com sucesso!</h2><div class="equipment-flow-muted">Os dados foram confirmados no banco de dados.</div>
    <div class="equipment-flow-name">${escapeHtml(validatedDraft.name)}</div>
    <div class="equipment-flow-details"><div>✓ Informações gerais salvas</div><div>✓ ${Object.keys(validatedDraft.variants).length} raridades processadas</div><div>✓ ${attributeCount} atributos confirmados</div><div>✓ ${created ? 'Novo cadastro criado' : `${selectedCount} alterações aplicadas`}</div></div>
    <div class="equipment-flow-foot"><button class="equipment-flow-btn" data-success="continue">Continuar editando</button><a class="equipment-flow-btn" href="./equipments.html">Voltar à lista</a><a class="equipment-flow-btn primary" href="./equipment-editor.html?id=${encodeURIComponent(saved.id)}">Abrir equipamento salvo</a></div>
  </div></div>`;
  overlay.classList.add('is-visible');
  overlay.querySelector('[data-success="continue"]').onclick = closeFlow;
}

async function performSave(existing = null, selectedKeys = null) {
  const selected = new Set(selectedKeys || []);
  const updateAll = !existing || selectedKeys === null;
  const current = existing || {};
  const setSelected = updateAll || selected.has('set_id');
  const setId = setSelected ? await resolveSetId() : (current.set_id || null);
  const take = (key, incoming, oldValue) => updateAll || selected.has(key) ? incoming : oldValue;
  let variants;

  if (updateAll) {
    variants = buildVariants();
  } else {
    const oldVariants = new Map(
      (pendingUpdate?.bundle?.variants || []).map(row => [
        row.equipment_rarities?.slug,
        row.attributes || []
      ])
    );

    variants = meta.rarities.map(rarity => {
      const selectedFields = (pendingUpdate?.diff || []).filter(item =>
        item.raritySlug === rarity.slug && selected.has(item.key)
      );
      if (!selectedFields.length) return null;

      const attributes = new Map(
        (oldVariants.get(rarity.slug) || []).map(item => [normalizeText(item.label), item])
      );
      selectedFields.forEach(item => {
        attributes.set(normalizeText(item.attribute.label), item.attribute);
      });

      return {
        rarity_id: rarity.id,
        attributes: [...attributes.values()]
      };
    }).filter(Boolean);
  }
  const bonuses = incomingBonuses().filter(bonus => updateAll || selected.has(`bonus:${bonus.required_pieces}`));
  const saved = await saveEquipmentBundle({
    equipmentId: existing?.id || null,
    equipment: {
      name: take('name', validatedDraft.name, current.name),
      slug: validatedDraft.slug || slugify(validatedDraft.name),
      slot_id: take('slot_id', slotSelect.value, current.slot_id),
      set_id: setId,
      description: take('description', validatedDraft.description || current.description || '', current.description || ''),
      recommendation: take('recommendation', validatedDraft.recommendation || current.recommendation || '', current.recommendation || ''),
      image_path: current.image_path || null,
      enabled: take('enabled', validatedDraft.enabled !== false, current.enabled !== false),
      display_order: take('display_order', validatedDraft.displayOrder ?? current.display_order ?? 0, current.display_order ?? 0)
    },
    variants,
    bonuses
  });
  editLink.href = `./equipment-editor.html?id=${encodeURIComponent(saved.id)}`;
  successActions.classList.add('is-visible');
  showStatus(saved.operation === 'updated' ? 'Equipamento atualizado com sucesso.' : 'Equipamento criado com sucesso.', 'ok');
  showSuccess(saved, selected.size);
  return saved;
}

async function saveEquipment() {
  if (
    isSaving ||
    !validatedDraft ||
    !slotSelect.value
  ) {
    return;
  }

  isSaving = true;
  updateSaveState();

  const originalText =
    saveButton.textContent;

  saveButton.textContent =
    'Abrindo revisão...';

  successActions.classList.remove(
    'is-visible'
  );

  try {
    const slug =
      validatedDraft.slug ||
      slugify(
        validatedDraft.name
      );

    if (!slug) {
      throw new Error(
        'Não foi possível gerar o slug do equipamento.'
      );
    }

    const existing =
      await getEquipmentBySlug(
        slug
      );

    if (existing) {
      const bundle =
        await getEquipmentBundle(
          existing.id
        );

      renderUpdateAssistant(
        existing,
        bundle
      );

      return;
    }

    const selectedOption =
      slotSelect.options[
        slotSelect.selectedIndex
      ];

    const editorDraft = {
      name:
        validatedDraft.name,
      slug,
      setName:
        validatedDraft.setName || '',
      description:
        validatedDraft.description || '',
      recommendation:
        validatedDraft.recommendation || '',
      variants:
        validatedDraft.variants,
      bonuses:
        validatedDraft.bonuses,
      enabled:
        validatedDraft.enabled !== false,
      displayOrder:
        validatedDraft.displayOrder ??
        existing?.display_order ??
        0,
      slotId:
        slotSelect.value,
      slot_id:
        slotSelect.value,
      slotSlug:
        selectedOption?.dataset?.slug || '',
      slotName:
        selectedOption?.textContent?.trim() || '',
      importedAt:
        new Date().toISOString(),
      importSource:
        'equipment-json'
    };

    sessionStorage.setItem(
      'equipment-import-draft',
      JSON.stringify(editorDraft)
    );

    sessionStorage.setItem(
      'equipment-import-mode',
      'create'
    );

    const editorUrl =
      './equipment-editor.html?import=1&source=json';

    window.location.href =
      editorUrl;
  } catch (error) {
    console.error(
      'Erro ao salvar equipamento:',
      error
    );

    showStatus(
      error.message ||
      'Não foi possível salvar o equipamento.',
      'error'
    );
  } finally {
    isSaving = false;
    saveButton.textContent =
      originalText;
    updateSaveState();
  }
}

function clearAll() {
  jsonArea.value = '';
  validatedDraft = null;
  slotSelect.value = '';
  slotSelect.disabled = true;

  slotSelect.innerHTML = `
    <option value="">
      Valide o JSON primeiro
    </option>
  `;

  document
    .getElementById(
      'review-name'
    )
    .textContent =
      'Aguardando JSON';

  document
    .getElementById(
      'review-slot'
    )
    .textContent =
      'Não selecionado';

  document
    .getElementById(
      'review-set'
    )
    .textContent =
      '—';

  document
    .getElementById(
      'review-rarities'
    )
    .textContent =
      '0';

  document
    .getElementById(
      'review-attributes'
    )
    .textContent =
      '0';

  document
    .getElementById(
      'review-rarity-list'
    )
    .innerHTML =
      '';

  document
    .getElementById(
      'review-warnings'
    )
    .innerHTML =
      '';

  statusBox.className =
    'equipment-ai-status';

  statusBox.textContent =
    '';

  successActions.classList.remove(
    'is-visible'
  );

  updateSaveState();

  jsonArea.focus();
}

validateButton.addEventListener(
  'click',
  () => {
    try {
      const parsed =
        JSON.parse(
          extractJson(
            jsonArea.value
          )
        );

      validatedDraft =
        normalizeData(
          parsed
        );

      if (!validatedDraft.name) {
        throw new Error(
          'O JSON precisa conter o nome do equipamento.'
        );
      }

      populateSlots();
      renderReview(
        validatedDraft
      );
    } catch (error) {
      validatedDraft = null;
      slotSelect.disabled = true;
      updateSaveState();

      showStatus(
        error.message ||
        'Não foi possível validar o JSON.',
        'error'
      );
    }
  }
);

slotSelect.addEventListener(
  'change',
  () => {
    const selectedOption =
      slotSelect.options[
        slotSelect.selectedIndex
      ];

    document
      .getElementById(
        'review-slot'
      )
      .textContent =
        selectedOption?.value
          ? selectedOption.textContent
          : 'Não selecionado';

    updateSaveState();
  }
);

saveButton.addEventListener(
  'click',
  saveEquipment
);

clearButton.addEventListener(
  'click',
  clearAll
);

newButton.addEventListener(
  'click',
  clearAll
);

jsonArea.addEventListener(
  'input',
  () => {
    validatedDraft = null;
    slotSelect.disabled = true;
    successActions.classList.remove(
      'is-visible'
    );
    updateSaveState();
  }
);

meta =
  await loadEquipmentMeta();

updateSaveState();

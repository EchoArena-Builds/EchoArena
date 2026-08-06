import { initAdminShell } from './js/admin-shell.js';

const shell = await initAdminShell({
  activeId: 'hero-import',
  pageTitle: 'Importador de Heróis',
  pageSubtitle: 'Validação e revisão assistida'
});

if (!shell) {
  throw new Error(
    'Não foi possível iniciar o painel administrativo.'
  );
}

const IMPORT_SCHEMA_VERSION = 1;

const FIELD_LABELS = {
  hero: {
    name: 'Nome',
    class: 'Classe',
    description: 'Descrição',
    displayOrder: 'Ordem de exibição',
    active: 'Publicação'
  },

  status: {
    power: 'Poder',
    health: 'Vida',
    damage: 'Dano',
    armor: 'Armadura',
    visionRange: 'Alcance de visão',
    movementNoiseRadius: 'Raio do barulho de movimentação',
    maxMovementSpeed: 'Velocidade máxima',
    aimedMovementSpeed: 'Velocidade ao mirar',
    penetrationResistance: 'Resistência à perfuração',
    armorValue: 'Valor de armadura',
    armorResistance: 'Resistência de armadura'
  },

  weaponSummary: {
    name: 'Nome da arma',
    firepower: 'Poder de fogo',
    armorBreak: 'Quebra de armadura',
    fireRate: 'Cadência',
    magazineCapacity: 'Capacidade de munição',
    effectiveRange: 'Alcance efetivo',
    aimingStability: 'Estabilidade de mira'
  },

  weaponDetails: {
    damagePerShot: 'Dano por tiro',
    healthDamageMultiplier: 'Modificador contra vida',
    armorPenetration: 'Perfuração de armadura',
    penetrationPower: 'Poder de perfuração',
    armorDroneMultiplier: 'Modificador contra armadura e drones',
    shotsPerSecond: 'Tiros por segundo',
    reloadTime: 'Tempo de recarga',
    magazineSize: 'Tamanho do pente',
    hipFireRange: 'Alcance sem mira',
    aimedRange: 'Alcance com mira',
    dispersion: 'Dispersão',
    movingDispersion: 'Dispersão em movimento',
    aimedDispersion: 'Dispersão com mira',
    aimTime: 'Tempo de mira',
    dispersionFactor: 'Fator de dispersão'
  },

  meta: {
    rarity: 'Raridade',
    faction: 'Facção'
  }
};

const REQUIRED_FIELDS = [
  ['hero', 'name'],
  ['hero', 'class'],
  ['status', 'power'],
  ['status', 'health'],
  ['status', 'damage'],
  ['status', 'armor']
];

const jsonArea =
  document.getElementById('hero-import-json');

const validateButton =
  document.getElementById('hero-import-validate');

const exampleButton =
  document.getElementById('hero-import-example');

const clearButton =
  document.getElementById('hero-import-clear');

const emptyState =
  document.getElementById('hero-import-empty');

const review =
  document.getElementById('hero-import-review');

const statusBox =
  document.getElementById('hero-import-status');

const reviewBadge =
  document.getElementById('hero-import-review-badge');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

  const number = Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}

function extractJson(value = '') {
  const text = String(value).trim();

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

  const hero =
    source.hero &&
    typeof source.hero === 'object'
      ? source.hero
      : source;

  const status =
    source.status &&
    typeof source.status === 'object'
      ? source.status
      : (
          source.heroParameters &&
          typeof source.heroParameters === 'object'
            ? source.heroParameters
            : {}
        );

  const summary =
    source.weaponSummary &&
    typeof source.weaponSummary === 'object'
      ? source.weaponSummary
      : {};

  const weapon =
    source.weaponDetails &&
    typeof source.weaponDetails === 'object'
      ? source.weaponDetails
      : (
          source.weapon &&
          typeof source.weapon === 'object'
            ? source.weapon
            : {}
        );

  const meta =
    source.meta &&
    typeof source.meta === 'object'
      ? source.meta
      : {};

  return {
    schemaVersion:
      Number(source.schemaVersion) ||
      IMPORT_SCHEMA_VERSION,

    hero: {
      name:
        hero.name ??
        source.name ??
        null,

      class:
        hero.class ??
        hero.heroClass ??
        source.heroClass ??
        source.class ??
        null,

      description:
        hero.description ??
        source.description ??
        null,

      displayOrder:
        nullableNumber(
          hero.displayOrder ??
          hero.display_order ??
          source.displayOrder ??
          source.display_order
        ),

      active:
        hero.active ??
        hero.enabled ??
        source.active ??
        source.enabled ??
        null
    },

    status: {
      power:
        nullableNumber(
          status.power ??
          source.power
        ),

      health:
        nullableNumber(
          status.health ??
          status.life ??
          source.health
        ),

      damage:
        nullableNumber(
          status.damage ??
          source.damage
        ),

      armor:
        nullableNumber(
          status.armor ??
          source.armor
        ),

      visionRange:
        nullableNumber(
          status.visionRange ??
          status.vision_range
        ),

      movementNoiseRadius:
        nullableNumber(
          status.movementNoiseRadius ??
          status.movement_noise_radius
        ),

      maxMovementSpeed:
        nullableNumber(
          status.maxMovementSpeed ??
          status.max_movement_speed
        ),

      aimedMovementSpeed:
        nullableNumber(
          status.aimedMovementSpeed ??
          status.aimed_movement_speed
        ),

      penetrationResistance:
        nullableNumber(
          status.penetrationResistance ??
          status.penetration_resistance
        ),

      armorValue:
        nullableNumber(
          status.armorValue ??
          status.armor_value
        ),

      armorResistance:
        nullableNumber(
          status.armorResistance ??
          status.armor_resistance
        )
    },

    weaponSummary: {
      name:
        summary.name ??
        weapon.name ??
        null,

      firepower:
        nullableNumber(
          summary.firepower ??
          weapon.firepower
        ),

      armorBreak:
        nullableNumber(
          summary.armorBreak ??
          summary.armor_break ??
          weapon.armorBreak
        ),

      fireRate:
        nullableNumber(
          summary.fireRate ??
          summary.fire_rate ??
          weapon.fireRate
        ),

      magazineCapacity:
        nullableNumber(
          summary.magazineCapacity ??
          summary.magazine_capacity ??
          weapon.magazineCapacity
        ),

      effectiveRange:
        nullableNumber(
          summary.effectiveRange ??
          summary.effective_range ??
          weapon.effectiveRange
        ),

      aimingStability:
        nullableNumber(
          summary.aimingStability ??
          summary.aiming_stability ??
          weapon.aimingStability
        )
    },

    weaponDetails: {
      damagePerShot:
        nullableNumber(
          weapon.damagePerShot ??
          weapon.damage_per_shot
        ),

      healthDamageMultiplier:
        nullableNumber(
          weapon.healthDamageMultiplier ??
          weapon.health_damage_multiplier
        ),

      armorPenetration:
        nullableNumber(
          weapon.armorPenetration ??
          weapon.armor_penetration
        ),

      penetrationPower:
        nullableNumber(
          weapon.penetrationPower ??
          weapon.penetration_power
        ),

      armorDroneMultiplier:
        nullableNumber(
          weapon.armorDroneMultiplier ??
          weapon.armor_drone_multiplier
        ),

      shotsPerSecond:
        nullableNumber(
          weapon.shotsPerSecond ??
          weapon.shots_per_second
        ),

      reloadTime:
        nullableNumber(
          weapon.reloadTime ??
          weapon.reload_time
        ),

      magazineSize:
        nullableNumber(
          weapon.magazineSize ??
          weapon.magazine_size
        ),

      hipFireRange:
        nullableNumber(
          weapon.hipFireRange ??
          weapon.hip_fire_range
        ),

      aimedRange:
        nullableNumber(
          weapon.aimedRange ??
          weapon.aimed_range
        ),

      dispersion:
        nullableNumber(
          weapon.dispersion
        ),

      movingDispersion:
        nullableNumber(
          weapon.movingDispersion ??
          weapon.moving_dispersion
        ),

      aimedDispersion:
        nullableNumber(
          weapon.aimedDispersion ??
          weapon.aimed_dispersion
        ),

      aimTime:
        nullableNumber(
          weapon.aimTime ??
          weapon.aim_time
        ),

      dispersionFactor:
        nullableNumber(
          weapon.dispersionFactor ??
          weapon.dispersion_factor
        )
    },

    meta: {
      rarity:
        meta.rarity ??
        source.rarity ??
        null,

      faction:
        meta.faction ??
        source.faction ??
        null
    }
  };
}

function isPresent(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== ''
  );
}

function formatValue(value) {
  if (value === true) return 'Ativo';
  if (value === false) return 'Inativo';

  return isPresent(value)
    ? String(value)
    : 'Não informado';
}

function renderFields(
  containerId,
  countId,
  sectionName,
  values
) {
  const container =
    document.getElementById(containerId);

  const counter =
    document.getElementById(countId);

  const labels =
    FIELD_LABELS[sectionName];

  const entries =
    Object.entries(labels);

  const presentCount =
    entries.filter(
      ([key]) =>
        isPresent(values[key])
    ).length;

  counter.textContent =
    `${presentCount} de ${entries.length}`;

  container.innerHTML =
    entries.map(([key, label]) => {
      const value =
        values[key];

      const missing =
        !isPresent(value);

      return `
        <div class="hero-import-field ${missing ? 'is-missing' : ''}">
          <small>${escapeHtml(label)}</small>

          <strong>
            ${escapeHtml(formatValue(value))}
          </strong>
        </div>
      `;
    }).join('');

  return {
    present: presentCount,
    total: entries.length
  };
}

function updateSteps(valid) {
  const jsonStep =
    document.querySelector(
      '[data-step="json"]'
    );

  const validateStep =
    document.querySelector(
      '[data-step="validate"]'
    );

  const reviewStep =
    document.querySelector(
      '[data-step="review"]'
    );

  jsonStep.classList.add(
    'is-complete'
  );

  jsonStep.classList.remove(
    'is-active'
  );

  validateStep.classList.toggle(
    'is-complete',
    valid
  );

  validateStep.classList.toggle(
    'is-active',
    !valid
  );

  reviewStep.classList.toggle(
    'is-active',
    valid
  );
}

function showStatus(
  text,
  type = ''
) {
  statusBox.textContent =
    text;

  statusBox.className =
    `hero-import-status is-visible ${type}`.trim();
}

function clearReview() {
  emptyState.style.display =
    '';

  review.classList.remove(
    'is-visible'
  );

  reviewBadge.textContent =
    'Aguardando';

  reviewBadge.style.borderColor =
    '';

  reviewBadge.style.color =
    '';

  statusBox.className =
    'hero-import-status';

  statusBox.textContent =
    '';

  document
    .querySelectorAll(
      '.hero-import-step'
    )
    .forEach(step => {
      step.classList.remove(
        'is-active',
        'is-complete'
      );
    });

  document
    .querySelector(
      '[data-step="json"]'
    )
    .classList.add(
      'is-active'
    );
}

function validateAndRender() {
  try {
    const parsed =
      JSON.parse(
        extractJson(
          jsonArea.value
        )
      );

    const data =
      normalizeData(parsed);

    const warnings = [];

    if (
      data.schemaVersion !==
      IMPORT_SCHEMA_VERSION
    ) {
      warnings.push(
        `O JSON usa a versão ${data.schemaVersion}; ` +
        `esta página espera a versão ${IMPORT_SCHEMA_VERSION}.`
      );
    }

    for (
      const [section, field]
      of REQUIRED_FIELDS
    ) {
      if (
        !isPresent(
          data[section]?.[field]
        )
      ) {
        const label =
          FIELD_LABELS[section]?.[field] ||
          `${section}.${field}`;

        warnings.push(
          `Campo obrigatório ausente: ${label}.`
        );
      }
    }

    const generalResult =
      renderFields(
        'review-general',
        'review-general-count',
        'hero',
        data.hero
      );

    const statusResult =
      renderFields(
        'review-status-fields',
        'review-status-count',
        'status',
        data.status
      );

    const summaryResult =
      renderFields(
        'review-weapon-summary',
        'review-weapon-summary-count',
        'weaponSummary',
        data.weaponSummary
      );

    const detailsResult =
      renderFields(
        'review-weapon-details',
        'review-weapon-details-count',
        'weaponDetails',
        data.weaponDetails
      );

    const metaPresent =
      Object.values(data.meta)
        .filter(isPresent)
        .length;

    const totalPresent =
      generalResult.present +
      statusResult.present +
      summaryResult.present +
      detailsResult.present +
      metaPresent;

    const totalFields =
      generalResult.total +
      statusResult.total +
      summaryResult.total +
      detailsResult.total +
      Object.keys(
        FIELD_LABELS.meta
      ).length;

    const completion =
      totalFields
        ? Math.round(
            (
              totalPresent /
              totalFields
            ) * 100
          )
        : 0;

    document
      .getElementById(
        'review-name'
      )
      .textContent =
        data.hero.name ||
        'Herói sem nome';

    const meta = [
      data.hero.class,
      data.meta.rarity,
      data.meta.faction
    ]
      .filter(isPresent)
      .join(' · ');

    document
      .getElementById(
        'review-meta'
      )
      .textContent =
        meta ||
        'Classe, raridade e facção não informadas.';

    document
      .getElementById(
        'review-completion'
      )
      .textContent =
        `${completion}%`;

    document
      .getElementById(
        'review-completion-bar'
      )
      .style.width =
        `${completion}%`;

    const warningContainer =
      document.getElementById(
        'review-warnings'
      );

    const warningSection =
      document.getElementById(
        'review-warnings-section'
      );

    document
      .getElementById(
        'review-warning-count'
      )
      .textContent =
        String(warnings.length);

    if (warnings.length) {
      warningSection.style.display =
        '';

      warningContainer.innerHTML =
        warnings.map(item => `
          <div class="hero-import-warning">
            ${escapeHtml(item)}
          </div>
        `).join('');
    } else {
      warningSection.style.display =
        'none';

      warningContainer.innerHTML =
        '';
    }

    emptyState.style.display =
      'none';

    review.classList.add(
      'is-visible'
    );

    reviewBadge.textContent =
      warnings.length
        ? 'Com avisos'
        : 'Válido';

    reviewBadge.style.borderColor =
      warnings.length
        ? '#6f5618'
        : '#28583a';

    reviewBadge.style.color =
      warnings.length
        ? '#ffd76d'
        : '#8fd3a6';

    showStatus(
      warnings.length
        ? (
            `JSON válido, mas foram encontrados ` +
            `${warnings.length} aviso(s).`
          )
        : (
            'JSON válido e campos obrigatórios presentes.'
          ),
      warnings.length
        ? 'warn'
        : 'ok'
    );

    updateSteps(true);
  } catch (error) {
    clearReview();

    showStatus(
      error.message ||
      'Não foi possível validar o JSON.',
      'error'
    );

    reviewBadge.textContent =
      'Inválido';

    reviewBadge.style.borderColor =
      '#75353d';

    reviewBadge.style.color =
      '#ff9da5';

    updateSteps(false);
  }
}

const example = {
  schemaVersion: 1,

  hero: {
    name: 'Slayer',
    class: 'Franco-atirador',
    description:
      'Slayer usa um poderoso rifle de precisão.',
    displayOrder: null,
    active: true
  },

  status: {
    power: 2535,
    health: 821,
    damage: 2557,
    armor: 829,
    visionRange: 725,
    movementNoiseRadius: 300,
    maxMovementSpeed: 171,
    aimedMovementSpeed: 51,
    penetrationResistance: 4,
    armorValue: 829,
    armorResistance: 10
  },

  weaponSummary: {
    name: 'Rifle de precisão',
    firepower: 1653,
    armorBreak: 2710,
    fireRate: 213,
    magazineCapacity: 83,
    effectiveRange: 1651,
    aimingStability: 453
  },

  weaponDetails: {
    damagePerShot: 2557,
    healthDamageMultiplier: 1.12,
    armorPenetration: 85,
    penetrationPower: 32,
    armorDroneMultiplier: 2.35,
    shotsPerSecond: 0.3,
    reloadTime: 4.2,
    magazineSize: 11,
    hipFireRange: 439,
    aimedRange: 508,
    dispersion: 54,
    movingDispersion: 5,
    aimedDispersion: 4,
    aimTime: 1.7,
    dispersionFactor: 0.9
  },

  meta: {
    rarity: 'Divino',
    faction: 'Força e Armas'
  }
};

validateButton.addEventListener(
  'click',
  validateAndRender
);

exampleButton.addEventListener(
  'click',
  () => {
    jsonArea.value =
      JSON.stringify(
        example,
        null,
        2
      );

    validateAndRender();
  }
);

clearButton.addEventListener(
  'click',
  () => {
    jsonArea.value = '';
    clearReview();
    jsonArea.focus();
  }
);

jsonArea.addEventListener(
  'input',
  () => {
    if (!jsonArea.value.trim()) {
      clearReview();
    }
  }
);

/**
 * Echo Arena — Motor dinâmico de estatísticas
 *
 * Responsabilidades:
 * - combinar status base do herói e da arma;
 * - aplicar modificadores de equipamentos;
 * - aplicar bônus de conjuntos;
 * - recalcular tudo quando herói, equipamento ou raridade mudar;
 * - gerar comparações entre valor base e valor final.
 */

const VALID_OPERATIONS = new Set([
  'add',
  'subtract',
  'multiply',
  'percent',
  'set',
  'min',
  'max'
]);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneObject(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

/**
 * Converte diferentes formatos recebidos do Supabase
 * para um objeto simples:
 *
 * {
 *   health: 821,
 *   armor: 829,
 *   weapon_damage: 2557
 * }
 */
export function normalizeStats(input) {
  if (!input) return {};

  if (!Array.isArray(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        toNumber(value)
      ])
    );
  }

  return input.reduce((result, row) => {
    const key = row.stat_key ?? row.key;

    if (!key) return result;

    result[key] = toNumber(row.value);
    return result;
  }, {});
}

/**
 * Normaliza um modificador vindo do Supabase.
 */
export function normalizeModifier(modifier) {
  if (!modifier) return null;

  const stat = modifier.stat_key ?? modifier.stat;
  const operation = String(modifier.operation ?? '').toLowerCase();

  if (!stat || !VALID_OPERATIONS.has(operation)) {
    return null;
  }

  return {
    id: modifier.id ?? null,
    stat,
    operation,
    value: toNumber(modifier.value),
    description: modifier.description ?? '',
    equipmentId:
      modifier.equipment_id ??
      modifier.equipmentId ??
      null,
    equipmentName:
      modifier.equipment_name ??
      modifier.equipmentName ??
      '',
    rarityId:
      modifier.rarity_id ??
      modifier.rarityId ??
      null,
    raritySlug:
      modifier.rarity_slug ??
      modifier.raritySlug ??
      '',
    setBonusId:
      modifier.set_bonus_id ??
      modifier.setBonusId ??
      null,
    source:
      modifier.source ??
      (modifier.set_bonus_id ? 'set' : 'equipment')
  };
}

/**
 * Aplica um único modificador.
 */
export function applyModifier(stats, modifier) {
  const normalized = normalizeModifier(modifier);

  if (!normalized) return stats;

  const current = toNumber(stats[normalized.stat]);
  const value = normalized.value;

  switch (normalized.operation) {
    case 'add':
      stats[normalized.stat] = current + value;
      break;

    case 'subtract':
      stats[normalized.stat] = current - value;
      break;

    case 'multiply':
      stats[normalized.stat] = current * value;
      break;

    case 'percent':
      stats[normalized.stat] = current * (1 + value / 100);
      break;

    case 'set':
      stats[normalized.stat] = value;
      break;

    case 'min':
      stats[normalized.stat] = Math.min(current, value);
      break;

    case 'max':
      stats[normalized.stat] = Math.max(current, value);
      break;
  }

  return stats;
}

/**
 * Ordenação importante:
 *
 * 1. set
 * 2. add/subtract
 * 3. percent
 * 4. multiply
 * 5. min/max
 *
 * Isso evita resultados imprevisíveis.
 */
export function sortModifiers(modifiers = []) {
  const priority = {
    set: 10,
    add: 20,
    subtract: 20,
    percent: 30,
    multiply: 40,
    min: 50,
    max: 50
  };

  return [...modifiers].sort((a, b) => {
    const operationA = normalizeModifier(a)?.operation;
    const operationB = normalizeModifier(b)?.operation;

    return (
      (priority[operationA] ?? 999) -
      (priority[operationB] ?? 999)
    );
  });
}

/**
 * Aplica uma coleção de modificadores.
 */
export function applyModifiers(stats, modifiers = []) {
  const result = cloneObject(stats);

  sortModifiers(modifiers).forEach(modifier => {
    applyModifier(result, modifier);
  });

  return result;
}

/**
 * Conta quantas peças de cada conjunto estão equipadas.
 *
 * Cada item equipado pode possuir:
 *
 * {
 *   set_id: 'uuid',
 *   set_name: 'Predador Sombrio'
 * }
 */
export function countEquippedSets(equippedItems = []) {
  return equippedItems.reduce((result, item) => {
    const setId =
      item?.set_id ??
      item?.setId ??
      item?.equipment_sets?.id;

    if (!setId) return result;

    if (!result[setId]) {
      result[setId] = {
        setId,
        setName:
          item?.set_name ??
          item?.setName ??
          item?.equipment_sets?.name ??
          'Conjunto',
        pieces: 0
      };
    }

    result[setId].pieces += 1;

    return result;
  }, {});
}

/**
 * Determina quais bônus de conjunto estão ativos.
 */
export function getActiveSetBonuses(
  equippedItems = [],
  availableBonuses = []
) {
  const setCounts = countEquippedSets(equippedItems);

  return availableBonuses
    .filter(bonus => {
      const setId =
        bonus.set_id ??
        bonus.setId;

      const requiredPieces = toNumber(
        bonus.required_pieces ??
        bonus.requiredPieces
      );

      return (
        setCounts[setId] &&
        setCounts[setId].pieces >= requiredPieces
      );
    })
    .map(bonus => ({
      ...bonus,
      active: true,
      equippedPieces:
        setCounts[bonus.set_id ?? bonus.setId]?.pieces ?? 0
    }));
}

/**
 * Extrai os modificadores internos dos bônus ativos.
 */
export function collectSetModifiers(activeBonuses = []) {
  return activeBonuses.flatMap(bonus => {
    const modifiers =
      bonus.modifiers ??
      bonus.equipment_set_bonus_modifiers ??
      [];

    return modifiers.map(modifier => ({
      ...modifier,
      set_bonus_id: bonus.id,
      source: 'set'
    }));
  });
}

/**
 * Calcula a diferença entre os valores iniciais e finais.
 */
export function calculateStatChanges(baseStats, finalStats) {
  const keys = new Set([
    ...Object.keys(baseStats ?? {}),
    ...Object.keys(finalStats ?? {})
  ]);

  return [...keys].reduce((result, key) => {
    const base = toNumber(baseStats?.[key]);
    const final = toNumber(finalStats?.[key]);
    const difference = final - base;

    result[key] = {
      base,
      final,
      difference,
      percent:
        base !== 0
          ? (difference / Math.abs(base)) * 100
          : final !== 0
            ? 100
            : 0
    };

    return result;
  }, {});
}

/**
 * Calcula a build completa.
 */
export function calculateBuild({
  heroStats = {},
  weaponStats = {},
  equipmentModifiers = [],
  equippedItems = [],
  setBonuses = [],
  extraModifiers = []
} = {}) {
  const normalizedHeroStats = normalizeStats(heroStats);
  const normalizedWeaponStats = normalizeStats(weaponStats);

  const baseStats = {
    ...normalizedHeroStats,
    ...normalizedWeaponStats
  };

  const activeSetBonuses = getActiveSetBonuses(
    equippedItems,
    setBonuses
  );

  const setModifiers = collectSetModifiers(
    activeSetBonuses
  );

  const allModifiers = [
    ...equipmentModifiers,
    ...setModifiers,
    ...extraModifiers
  ]
    .map(normalizeModifier)
    .filter(Boolean);

  const finalStats = applyModifiers(
    baseStats,
    allModifiers
  );

  const changes = calculateStatChanges(
    baseStats,
    finalStats
  );

  return {
    baseStats,
    finalStats,
    changes,
    appliedModifiers: allModifiers,
    activeSetBonuses,
    setCounts: countEquippedSets(equippedItems)
  };
}

/**
 * Formata um valor usando a configuração de stat_definitions.
 */
export function formatStatValue(value, definition = {}) {
  const numericValue = toNumber(value);

  const decimals = Number.isInteger(definition.decimals)
    ? definition.decimals
    : 0;

  const formatted = numericValue.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  const unit = definition.unit ?? '';

  if (!unit) return formatted;

  if (unit === 'x') {
    return `x${formatted}`;
  }

  if (unit === '%' || unit === '°' || unit === 's') {
    return `${formatted}${unit}`;
  }

  return `${formatted} ${unit}`;
}

/**
 * Retorna os status prontos para renderização.
 */
export function buildStatsView(
  calculation,
  definitions = []
) {
  const definitionMap = new Map(
    definitions.map(definition => [
      definition.key,
      definition
    ])
  );

  return Object.entries(
    calculation.finalStats ?? {}
  )
    .map(([key, value]) => {
      const definition = definitionMap.get(key) ?? {
        key,
        name: key,
        unit: '',
        decimals: 0,
        display_order: 9999,
        higher_is_better: true
      };

      const change = calculation.changes?.[key] ?? {
        base: value,
        final: value,
        difference: 0,
        percent: 0
      };

      const positiveChange =
        definition.higher_is_better !== false
          ? change.difference > 0
          : change.difference < 0;

      const negativeChange =
        definition.higher_is_better !== false
          ? change.difference < 0
          : change.difference > 0;

      return {
        key,
        name: definition.name,
        category: definition.category,
        baseValue: change.base,
        finalValue: change.final,
        difference: change.difference,
        percentDifference: change.percent,
        formattedBase: formatStatValue(
          change.base,
          definition
        ),
        formattedFinal: formatStatValue(
          change.final,
          definition
        ),
        formattedDifference:
          change.difference === 0
            ? ''
            : `${change.difference > 0 ? '+' : ''}${formatStatValue(
                change.difference,
                definition
              )}`,
        positiveChange,
        negativeChange,
        changed: change.difference !== 0,
        displayOrder:
          definition.display_order ??
          definition.displayOrder ??
          9999
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Busca todos os dados necessários para calcular uma build.
 */
export async function loadBuildCalculationData(
  supabase,
  {
    heroId,
    equipped = []
  }
) {
  if (!heroId) {
    throw new Error('Nenhum herói selecionado.');
  }

  const equipmentIds = equipped
    .map(item =>
      item.equipment_id ??
      item.equipmentId ??
      item.id
    )
    .filter(Boolean);

  const rarityIds = equipped
    .map(item =>
      item.rarity_id ??
      item.rarityId
    )
    .filter(Boolean);

  const [
    heroStatsResult,
    weaponStatsResult,
    definitionsResult,
    modifiersResult,
    setsResult
  ] = await Promise.all([
    supabase
      .from('hero_base_stats')
      .select('stat_key,value')
      .eq('hero_id', heroId),

    supabase
      .from('hero_weapon_stats')
      .select('stat_key,value,weapon_name')
      .eq('hero_id', heroId),

    supabase
      .from('stat_definitions')
      .select(`
        key,
        name,
        category,
        unit,
        value_type,
        decimals,
        higher_is_better,
        display_order
      `)
      .eq('enabled', true)
      .order('display_order'),

    equipmentIds.length && rarityIds.length
      ? supabase
          .from('equipment_modifiers')
          .select(`
            id,
            equipment_id,
            rarity_id,
            stat_key,
            operation,
            value,
            description,
            display_order
          `)
          .in('equipment_id', equipmentIds)
          .in('rarity_id', rarityIds)
          .eq('enabled', true)
      : Promise.resolve({
          data: [],
          error: null
        }),

    supabase
      .from('equipment_set_bonuses')
      .select(`
        id,
        set_id,
        required_pieces,
        title,
        description,
        display_order,
        equipment_set_bonus_modifiers (
          id,
          stat_key,
          operation,
          value,
          target_type,
          target_id,
          description,
          display_order
        )
      `)
      .order('display_order')
  ]);

  const results = [
    heroStatsResult,
    weaponStatsResult,
    definitionsResult,
    modifiersResult,
    setsResult
  ];

  const failedResult = results.find(
    result => result.error
  );

  if (failedResult) {
    throw failedResult.error;
  }

  return {
    heroStats: heroStatsResult.data ?? [],
    weaponStats: weaponStatsResult.data ?? [],
    definitions: definitionsResult.data ?? [],
    equipmentModifiers:
      modifiersResult.data ?? [],
    setBonuses: setsResult.data ?? []
  };
}

/**
 * Função principal que carrega e calcula a build.
 */
export async function calculateBuildFromSupabase(
  supabase,
  {
    heroId,
    equippedItems = []
  }
) {
  const data = await loadBuildCalculationData(
    supabase,
    {
      heroId,
      equipped: equippedItems
    }
  );

  const calculation = calculateBuild({
    heroStats: data.heroStats,
    weaponStats: data.weaponStats,
    equipmentModifiers:
      data.equipmentModifiers,
    equippedItems,
    setBonuses: data.setBonuses
  });

  return {
    ...calculation,
    definitions: data.definitions,
    statsView: buildStatsView(
      calculation,
      data.definitions
    )
  };
}
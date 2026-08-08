import { supabase } from './supabase.js';
import {
  RARIDADES, esc, cssSafe, numSafe, srcSafe, isVid,
  mStyle, mInner, normalizar, rc, rn,
  nivelAtual, nomeDoNivel, corDoItem, pintar
} from './ui-core.js';
import { carregarDadosAnalise, analisarBuild, renderAnalise } from './build-analise.js?v=11';

/* ============================================================
   CRIAR BUILD — lógica da página
   Mídia aceita .png .jpg .gif (transparente) .mp4 .webm
   media: { src, fit, pos, scale, x, y }
   ============================================================ */

const MEDIA_BUCKET = 'game-media';

/* Slots de reserva — só aparecem se equipment_slots vier vazio.
   Segue a ordem oficial do anel: ímpares à esquerda, pares à direita. */
const SLOTS_PADRAO = [
  { key: 'cabeca',    label: 'Cabeça' },
  { key: 'peito',     label: 'Peito' },
  { key: 'mao',       label: 'Mão' },
  { key: 'pe',        label: 'Pé' },
  { key: 'acessorio', label: 'Acessório' },
  { key: 'gadget',    label: 'Gadget' }
];

let CONFIG = {
  usuario: { nome: 'SlayerX', nivel: 42, media: { src: '', fit: 'cover' } },
  heroi:   { id: '', nome: '—', classe: '', media: { src: '', fit: 'contain' }, cardMedia: { src: '', fit: 'cover' } },
  slots:   SLOTS_PADRAO.map((s, i, a) => ({ ...s, ...posicaoAnel(i, a.length) })),
  equipados: {},
  analise: null,
  herois: [],
  catalogo: [],
  tiers: new Map(),
  tags: new Set(['Longo alcance', 'Controle']),

  /* Fonte única dos números: build-analise.js calcula a partir de
     hero_base_stats + stats do nível de cada equipamento. */
  dados: { baseHerois: new Map(), textos: new Map(), statsBonus: new Map() },
  macros: [],
  bonus: [],
  resumo: { tagA: '—', tagB: '—', texto: 'Escolha um herói e monte o loadout para ver o resumo.' }
};

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);

/* Posição do slot no anel: duas colunas espelhadas, barriga pra fora no meio.
   Funciona com qualquer quantidade de slots vinda do banco. */
function posicaoAnel(indice, total) {
  const esquerda = Math.ceil(total / 2);
  const naEsquerda = indice % 2 === 0;
  const ordemNaColuna = Math.floor(indice / 2);
  const qtdColuna = naEsquerda ? esquerda : total - esquerda;
  const t = qtdColuna <= 1 ? 0.5 : ordemNaColuna / (qtdColuna - 1);
  const curva = Math.sin(t * Math.PI);
  return {
    y: 12 + t * 72,
    x: naEsquerda ? 22 - 12 * curva : 78 + 12 * curva
  };
}

function getMediaUrl(path, legacyUrl = '') {
  if (path) {
    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return data?.publicUrl || legacyUrl || '';
  }
  return legacyUrl || '';
}

/* O editor administrativo atual salva os atributos como uma lista
   [{ label, value }]. Versões antigas salvavam um objeto JSON.
   A página aceita os dois formatos sem perder o texto exibido. */
function normalizeVariantStats(attributes) {
  if (Array.isArray(attributes)) {
    return Object.fromEntries(
      attributes
        .filter(attribute => String(attribute?.label || '').trim())
        .map(attribute => [
          String(attribute.label).trim(),
          attribute.value ?? ''
        ])
    );
  }

  return attributes && typeof attributes === 'object' ? attributes : {};
}

/* ============================================================
   SUPABASE — conteúdo administrável
   ============================================================ */
async function carregarConteudoSupabase() {
  const [
    heroesResult, classesResult, equipmentsResult, slotsResult,
    rarityLevelsResult, equipmentVariantsResult, equipmentRaritiesResult,
    equipmentSetsResult, setBonusesResult, tiersResult
  ] = await Promise.all([
    supabase.from('heroes').select(`
        id, name, slug, class_id, enabled, display_order,
        image_path, card_image_path, gif_path,
        image_url, card_image_url, gif_url,
        image_fit, image_position, image_scale, image_offset_x, image_offset_y,
        card_image_scale, card_image_offset_x, card_image_offset_y
      `)
      .eq('enabled', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true }),

    supabase.from('hero_classes').select('id,name,slug,color,icon')
      .order('name', { ascending: true }),

    supabase.from('equipments').select(`
        id, name, description, image_path, image_url, rarity,
        slot_id, set_id, recommendation_text, enabled, display_order
      `)
      .eq('enabled', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true }),

    supabase.from('equipment_slots').select('id,name,slug,display_order')
      .order('display_order', { ascending: true }),

    supabase.from('equipment_rarity_levels')
      .select('equipment_id,rarity_slug,rarity_name,rarity_order,rarity_color,stats')
      .order('rarity_order', { ascending: true }),

    /* Estrutura atual usada pelo editor administrativo. A leitura de
       equipment_rarity_levels acima fica apenas como compatibilidade com
       dados antigos; equipment_variants é a fonte prioritária. */
    supabase.from('equipment_variants')
      .select('equipment_id,rarity_id,attributes'),

    supabase.from('equipment_rarities')
      .select('id,slug,name,color,rank')
      .order('rank', { ascending: true }),

    supabase.from('equipment_sets').select('id,name,slug,description,image_path'),

    supabase.from('equipment_set_bonuses')
      .select('id,set_id,required_pieces,title,description,display_order')
      .order('required_pieces', { ascending: true })
      .order('display_order', { ascending: true }),

    supabase.from('equipment_tiers').select('id,slug,name,color')
      .order('display_order', { ascending: true })
  ]);

  const falhas = [
    ['heróis', heroesResult], ['classes', classesResult], ['equipamentos', equipmentsResult],
    ['slots', slotsResult], ['níveis', rarityLevelsResult],
    ['variantes', equipmentVariantsResult], ['raridades', equipmentRaritiesResult],
    ['conjuntos', equipmentSetsResult], ['bônus de conjunto', setBonusesResult],
    ['tiers', tiersResult]
  ].filter(([, r]) => r.error);

  falhas.forEach(([nome, r]) => console.error(`Erro ao carregar ${nome}:`, r.error));

  const classes = new Map((classesResult.data || []).map(i => [i.id, i]));
  const sets = new Map((equipmentSetsResult.data || []).map(i => [i.id, i]));
  const slotsPorId = new Map((slotsResult.data || []).map(i => [i.id, i]));

  const rarityLevelsBySlug = new Map();
  const addRarityLevel = level => {
    if (!level?.equipment_id || !level?.rarity_slug) return;
    if (!rarityLevelsBySlug.has(level.equipment_id)) {
      rarityLevelsBySlug.set(level.equipment_id, new Map());
    }
    rarityLevelsBySlug.get(level.equipment_id).set(level.rarity_slug, level);
  };

  /* Primeiro entram os registros legados. */
  for (const level of (rarityLevelsResult.data || [])) {
    addRarityLevel(level);
  }

  /* Depois as variantes atuais sobrescrevem os níveis equivalentes. */
  const raritiesById = new Map(
    (equipmentRaritiesResult.data || []).map(rarity => [rarity.id, rarity])
  );
  for (const variant of (equipmentVariantsResult.data || [])) {
    const rarity = raritiesById.get(variant.rarity_id);
    if (!rarity) continue;
    addRarityLevel({
      equipment_id: variant.equipment_id,
      rarity_slug: rarity.slug,
      rarity_name: rarity.name,
      rarity_order: rarity.rank,
      rarity_color: rarity.color,
      stats: normalizeVariantStats(variant.attributes)
    });
  }

  const rarityLevels = new Map(
    [...rarityLevelsBySlug].map(([equipmentId, levels]) => [
      equipmentId,
      [...levels.values()].sort((a, b) =>
        numSafe(a.rarity_order, 999) - numSafe(b.rarity_order, 999)
      )
    ])
  );

  const setBonuses = new Map();
  for (const bonus of (setBonusesResult.data || [])) {
    if (!setBonuses.has(bonus.set_id)) setBonuses.set(bonus.set_id, []);
    setBonuses.get(bonus.set_id).push(bonus);
  }

  CONFIG.tiers = new Map((tiersResult.data || []).map(tier => [tier.slug, tier]));

  /* --- slots do anel vêm do banco (sem apelidos, sem colisão) --- */
  const slotsDb = (slotsResult.data || []).filter(s => s.slug);
  if (slotsDb.length) {
    CONFIG.slots = slotsDb.map((s, i) => ({
      key: s.slug,
      label: s.name || s.slug,
      slotId: s.id,
      ...posicaoAnel(i, slotsDb.length)
    }));
  }

  /* --- heróis --- */
  const heroes = (heroesResult.data || []).map(hero => {
    const heroClass = classes.get(hero.class_id);
    const offsetX = `${numSafe(hero.image_offset_x, 0)}%`;
    const offsetY = `${numSafe(hero.image_offset_y, 0)}%`;
    const cardX = `${numSafe(hero.card_image_offset_x, 0)}%`;
    const cardY = `${numSafe(hero.card_image_offset_y, 0)}%`;

    const mainSource = getMediaUrl(
      hero.image_path || hero.card_image_path || hero.gif_path,
      hero.image_url || hero.card_image_url || hero.gif_url
    );
    const cardSource = getMediaUrl(
      hero.card_image_path || hero.image_path || hero.gif_path,
      hero.card_image_url || hero.image_url || hero.gif_url
    );

    return {
      id: hero.slug || hero.id,
      databaseId: hero.id,
      nome: hero.name,
      classe: heroClass?.name || 'Sem classe',
      cor: heroClass?.color || '#A855F7',
      media: {
        src: cardSource, fit: 'cover', pos: '50% 50%',
        scale: numSafe(hero.card_image_scale, 1), x: cardX, y: cardY
      },
      destaque: {
        src: mainSource, fit: hero.image_fit || 'contain', pos: hero.image_position || '50% 50%',
        scale: numSafe(hero.image_scale, 1), x: offsetX, y: offsetY
      }
    };
  });

  /* --- equipamentos --- */
  const equipments = (equipmentsResult.data || []).map(item => {
    const slot = slotsPorId.get(item.slot_id);
    const levels = rarityLevels.get(item.id) || [];
    const initialLevel = levels[0];
    const equipmentSet = sets.get(item.set_id) || null;

    return {
      databaseId: item.id,
      nome: item.name,
      slot: slot?.slug || null,
      slotLabel: slot?.name || '',
      raridade: initialLevel?.rarity_slug || String(item.rarity || 'comum').toLowerCase(),
      descricao: item.description || '',
      recommendation: item.recommendation_text || '',
      setId: item.set_id || null,
      set: equipmentSet ? {
        id: equipmentSet.id,
        nome: equipmentSet.name,
        slug: equipmentSet.slug,
        descricao: equipmentSet.description || '',
        bonus: setBonuses.get(equipmentSet.id) || []
      } : null,
      levels: levels.map(level => ({
        slug: level.rarity_slug,
        nome: level.rarity_name,
        ordem: level.rarity_order,
        cor: level.rarity_color || rc(level.rarity_slug),
        stats: level.stats || {}
      })),
      media: {
        src: getMediaUrl(item.image_path, item.image_url),
        fit: 'contain', pos: '50% 50%', scale: 1, x: 0, y: 0
      }
    };
  });

  if (heroes.length) {
    CONFIG.herois = heroes;
    const first = heroes[0];
    CONFIG.heroi = {
      id: first.id,
      databaseId: first.databaseId,
      nome: String(first.nome).toUpperCase(),
      classe: first.classe,
      media: first.destaque,
      cardMedia: first.media
    };
  }

  CONFIG.catalogo = equipments;
  CONFIG.equipados = {};
}

/* ---------- estado ---------- */
let heroiAtual = '';
let slotAtivo = null;
let etapa = 1;
let equipamentoSelecionado = null;
let buscaPop = '';

/* ---------- topo ---------- */
pintar($('user-av'), CONFIG.usuario.media);
$('user-nm').innerHTML = esc(CONFIG.usuario.nome) +
  `<small>Nível ${esc(CONFIG.usuario.nivel)}</small>`;

/* ---------- herói + slots ---------- */
function renderHeroi() {
  $('hero-name').textContent = CONFIG.heroi.nome;
  $('hero-role').textContent = CONFIG.heroi.classe;
  pintar($('hero-art'), CONFIG.heroi.media);
  pintar($('hero-card-art'), CONFIG.heroi.cardMedia || CONFIG.heroi.media);
  renderSlots();
  renderHeroBaseStats();
}

function renderHeroBaseStats() {
  const resultado = CONFIG.analise;
  const linhas = resultado?.linhas || [];
  const alvo = $('hero-base-stats');
  if (!alvo || !linhas.length) return;

  const mapa = [
    { keys: ['damage_per_shot'], icon: '⌖', label: 'DANO POR TIRO' },
    { keys: ['health', 'armor'], icon: '♢', label: 'VIDA BASE' },
    { keys: ['max_movement_speed'], icon: '♞', label: 'VELOCIDADE BASE' }
  ];

  alvo.innerHTML = mapa.map(item => {
    const linha = linhas.find(l => item.keys.includes(l.key));
    const pct = Math.max(4, Math.round(linha?.pctBase || 0));
    const valor = linha ? Math.round(linha.base).toLocaleString('pt-BR') : '—';
    return `<div><span>${item.icon} <b>${item.label}</b></span><i><u style="width:${pct}%"></u></i><em>${valor}</em></div>`;
  }).join('');
}

function renderSlots() {
  const ring = $('ring');
  ring.querySelectorAll('.slot').forEach(s => s.remove());

  const mob = $('slots-mobile');
  mob.innerHTML = '';

  const mobile = window.matchMedia('(max-width:560px)').matches;
  const mobileOrbitPositions = [
    { x: 14, y: 28 }, { x: 12, y: 50 }, { x: 15, y: 72 },
    { x: 86, y: 28 }, { x: 88, y: 50 }, { x: 85, y: 72 }
  ];

  CONFIG.slots.forEach((s, index) => {
    const it = CONFIG.equipados[s.key];
    const el = document.createElement('div');
    el.className = 'slot' + (it ? '' : ' empty') + (slotAtivo === s.key ? ' active' : '');
    el.dataset.slot = s.key;
    el.style.setProperty('--rc', corDoItem(it));

    el.innerHTML =
      `<div class="lb" title="${esc(s.label)}">${index + 1}</div>` +
      (it ? '<button class="rm" type="button" aria-label="Remover">✕</button>' : '') +
      '<div class="hex">' + (it
        ? `<div class="media ${it.media && it.media.src ? '' : 'ph'}" style="${mStyle(it.media)}">${mInner(it.media)}</div>`
        : '<span class="plus">+</span>') + '</div>' +
      (it
        ? `<div class="in"><b>${esc(it.nome)}</b><i>${esc(nomeDoNivel(it))}</i></div>`
        : '<div class="in"><b>Vazio</b></div>');

    el.onclick = e => {
      if (e.target.closest('.rm')) { limparSlot(s.key); return; }
      abrirPop(s.key);
    };

    const pos = mobile ? mobileOrbitPositions[index] : { x: s.x, y: s.y };
    el.style.position = 'absolute';
    el.style.left = pos.x + '%';
    el.style.top = pos.y + '%';
    el.style.transform = 'translate(-50%,-50%)';
    ring.appendChild(el);
  });

  atualizarContagem();
}

function atualizarContagem() {
  const n = CONFIG.slots.filter(s => CONFIG.equipados[s.key]).length;
  $('eq-count').textContent = n + '/' + CONFIG.slots.length;
}

function limparSlot(key) {
  delete CONFIG.equipados[key];
  if (equipamentoSelecionado && slotAtivo === key) equipamentoSelecionado = null;
  renderSlots();
  renderSinergia();
  renderDetalheEquipamento(CONFIG.equipados[slotAtivo] || null);
  renderBonus();
  atualizarAnalise();
  if (!$('pop').hidden) { $('pop-foot').hidden = true; renderCatalogo(); }
}

/* ---------- box flutuante de equipamentos ---------- */
function slotAtual() {
  return CONFIG.slots.find(s => s.key === slotAtivo) || null;
}

function abrirPop(key) {
  slotAtivo = key;
  buscaPop = '';
  $('pop-search').value = '';

  const s = slotAtual();
  $('pop-eyebrow').textContent =
    'Slot ' + (CONFIG.slots.findIndex(x => x.key === key) + 1) + ' de ' + CONFIG.slots.length;
  $('pop-title').textContent = s ? s.label : 'Equipamento';
  $('pop-foot').hidden = !CONFIG.equipados[key];

  $('pop').hidden = false;
  $('pop-back').hidden = false;

  renderSlots();
  renderCatalogo();
  renderDetalheEquipamento(CONFIG.equipados[key] || null);
  posicionarPop();
  progresso(2);
}

function fecharPop() {
  $('pop').hidden = true;
  $('pop-back').hidden = true;
  renderSlots();
}

/* Ancora o box no slot clicado: abre para o lado com espaço e
   nunca deixa a caixa sair da tela. No celular vira folha inferior. */
function posicionarPop() {
  const pop = $('pop');
  if (pop.hidden) return;

  const arrow = $('pop-arrow');

  if (window.matchMedia('(max-width:720px)').matches) {
    pop.style.left = '';
    pop.style.top = '';
    return;
  }

  /* Sempre consultar o DOM: renderSlots() recria os slots e
     qualquer referência guardada antes fica órfã. */
  const alvo = document.querySelector('.slot.active');
  if (!alvo) return;

  const r = alvo.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  const m = 12;

  const cabeDireita = window.innerWidth - r.right >= p.width + m * 2;
  const paraDireita = cabeDireita || r.left < p.width + m * 2;

  let left = paraDireita ? r.right + m : r.left - p.width - m;
  left = Math.max(m, Math.min(left, window.innerWidth - p.width - m));

  let top = r.top + r.height / 2 - p.height / 2;
  top = Math.max(m, Math.min(top, window.innerHeight - p.height - m));

  pop.style.left = left + 'px';
  pop.style.top = top + 'px';

  arrow.className = 'pop-arrow ' + (paraDireita ? 'l' : 'r');
  arrow.style.top = Math.max(16, Math.min(r.top + r.height / 2 - top - 6, p.height - 22)) + 'px';
}

function itensDoSlot() {
  const termo = normalizar(buscaPop).trim();
  return CONFIG.catalogo.filter(i => {
    const doSlot = !slotAtivo || i.slot === slotAtivo;
    const bate = !termo ||
      normalizar(i.nome).includes(termo) ||
      normalizar(i.set?.nome).includes(termo);
    return doSlot && bate;
  });
}

function renderCatalogo() {
  const base = CONFIG.catalogo.filter(i => !slotAtivo || i.slot === slotAtivo);
  $('pop-search-wrap').hidden = base.length <= 8;

  const lista = itensDoSlot();
  const alvo = $('ilist');
  const equipado = slotAtivo ? CONFIG.equipados[slotAtivo] : null;

  if (!lista.length) {
    alvo.innerHTML = `<div class="message">${base.length
      ? 'Nenhum equipamento com esse nome.'
      : 'Nenhum equipamento cadastrado para este slot.'}</div>`;
    return;
  }

  alvo.innerHTML = lista.map((i, idx) => {
    const sel = equipado && equipado.databaseId === i.databaseId;
    return `
      <button class="tile ${sel ? 'sel' : ''}" type="button" data-i="${idx}" style="--rc:${esc(corDoItem(i))}" title="${esc(i.nome)}">
        <span class="ic media ${i.media && i.media.src ? '' : 'ph'}" style="${mStyle(i.media)}">${mInner(i.media)}</span>
        <b>${esc(i.nome)}</b>
        <i>${esc(nomeDoNivel(i))}</i>
        ${sel ? '<span class="ok">\u2713</span>' : ''}
      </button>`;
  }).join('');

  alvo.onclick = e => {
    const el = e.target.closest('.tile');
    if (!el) return;
    equipar(lista[+el.dataset.i]);
  };
}

function equipar(item) {
  if (!item) return;
  const destino = slotAtivo || item.slot || CONFIG.slots[0]?.key;
  if (!destino) return;

  CONFIG.equipados[destino] = {
    databaseId: item.databaseId,
    nome: item.nome,
    raridade: item.raridade,
    media: item.media,
    setId: item.setId,
    set: item.set,
    levels: item.levels,
    descricao: item.descricao,
    recommendation: item.recommendation,
    slot: item.slot,
    slotLabel: item.slotLabel
  };

  slotAtivo = destino;
  $('pop-foot').hidden = false;
  renderSlots();
  renderCatalogo();
  renderDetalheEquipamento(CONFIG.equipados[destino]);
  renderSinergia();
  renderBonus();
  atualizarAnalise();
  progresso(2);
}

/* ---------- detalhe do equipamento ---------- */
function formatStatLabel(key) {
  const labels = {
    vision_range: 'Alcance de visão do herói',
    weapon_damage_to_armor_pct: 'Dano da arma à armadura inimiga',
    weapon_damage_to_health_pct: 'Dano da arma à vida inimiga',
    weapon_range_franco: 'Alcance de tiro do Franco',
    special_ability_cooldown_pct: 'Recarga da habilidade especial',
    crate_opening_cooldown_pct: 'Tempo de abertura da caixa'
  };
  return labels[key] || key.replaceAll('_', ' ');
}

function formatStatValue(key, value) {
  const sinal = Number(value) >= 0 ? '+' : '';
  return key.endsWith('_pct') ? `${sinal}${value}%` : `${sinal}${value}`;
}

function quantidadeDoConjunto(setId) {
  if (!setId) return 0;
  return Object.values(CONFIG.equipados).filter(item => item?.setId === setId).length;
}

function renderDetalheEquipamento(item = equipamentoSelecionado) {
  const detail = $('equipment-detail');
  const floating = $('equipment-float');

  if (!item) {
    equipamentoSelecionado = null;
    detail.className = 'eq-detail empty';
    detail.textContent = 'Toque num slot ao redor do herói para escolher e ver níveis, atributos e bônus do conjunto.';
    if (floating) floating.innerHTML = '<span class="equipment-float-icon">◇</span><div><strong>SELECIONE UM EQUIPAMENTO</strong><small>Os bônus aparecem aqui</small></div>';
    return;
  }

  equipamentoSelecionado = item;

  const level = nivelAtual(item);
  const stats = level?.stats || {};
  const pieces = quantidadeDoConjunto(item.setId);
  const bonuses = item.set?.bonus || [];
  const maxPieces = Math.max(CONFIG.slots.length, ...bonuses.map(b => b.required_pieces || 0)) || 1;
  const cor = corDoItem(item);
  const slotDoItem = CONFIG.slots.find(s => CONFIG.equipados[s.key]?.databaseId === item.databaseId);

  if (floating) {
    const deltas = Object.entries(stats).slice(0, 3).map(([key, value]) => {
      const n = Number(value) || 0;
      const classe = n >= 0 ? 'up' : 'down';
      return `<span class="${classe}">${n >= 0 ? '↑ +' : '↓ '}${esc(String(value))}${key.endsWith('_pct') ? '%' : ''} <i>${esc(formatStatLabel(key))}</i></span>`;
    }).join('');
    floating.innerHTML = `<span class="equipment-float-icon">◇</span><div><strong>${esc(item.nome)}</strong><small>${esc(slotDoItem?.label || item.slotLabel || 'Equipamento')}</small><div class="delta-list">${deltas || '<span class="up">✓ Equipado na mesa</span>'}</div></div>`;
  }

  detail.className = 'eq-detail';
  detail.innerHTML = `
    ${slotDoItem ? `<div class="eq-slotline"><span>Equipado em</span><b>${esc(slotDoItem.label)}</b></div>` : ''}

    <div class="eq-head">
      <div class="art media ${item.media?.src ? '' : 'ph'}" style="${mStyle(item.media)}">${mInner(item.media)}</div>
      <div>
        <div class="set-name">${esc(item.set?.nome || 'Equipamento individual')}</div>
        <h3>${esc(item.nome)}</h3>
        <span style="font-size:10px;font-weight:800;color:${esc(cor)}">${esc(nomeDoNivel(item))}</span>
        <p>${esc(item.descricao)}</p>
      </div>
    </div>

    <div class="eq-section">
      <div class="eq-section-title"><span>Escolha sua classificação</span><span>${esc(level?.nome || '')}</span></div>
      <div class="rarity-picker">
        ${(item.levels || []).map(l => `<button class="rarity-btn ${l.slug === item.raridade ? 'on' : ''}" type="button" data-rarity="${esc(l.slug)}" style="--rc:${esc(l.cor)}">${esc(l.nome)}</button>`).join('')}
      </div>
    </div>

    <div class="eq-section">
      <div class="eq-section-title"><span>Atributos neste nível</span><span>${Object.keys(stats).length}</span></div>
      <div class="eq-stats">
        ${Object.entries(stats).map(([key, value]) => `<div class="eq-stat" style="--rc:${esc(cor)}"><span>${esc(formatStatLabel(key))}</span><strong>${esc(formatStatValue(key, value))}</strong></div>`).join('') || '<div class="message">Sem atributos cadastrados.</div>'}
      </div>
    </div>

    ${item.set ? `<div class="eq-section">
      <div class="eq-section-title"><span>${esc(item.set.nome)}</span><span>${pieces}/${maxPieces} peças</span></div>
      <div class="set-progress"><div class="track2"><i style="width:${Math.min(100, (pieces / maxPieces) * 100)}%"></i></div><b>${pieces}/${maxPieces}</b></div>
      <div class="set-bonuses">
        ${bonuses.map(b => `<div class="set-bonus ${pieces >= b.required_pieces ? 'active' : ''}"><div class="pieces">${esc(b.required_pieces)}</div><div><b>${esc(b.title)}</b><p>${esc(b.description)}</p></div></div>`).join('')}
      </div>
    </div>` : ''}

    ${item.recommendation ? `<div class="eq-section"><div class="recommendation"><b>Indicação</b>${esc(item.recommendation)}</div></div>` : ''}
  `;

  detail.querySelectorAll('[data-rarity]').forEach(button => {
    button.onclick = () => {
      item.raridade = button.dataset.rarity;

      const equipado = Object.values(CONFIG.equipados).find(eq => eq?.databaseId === item.databaseId);
      if (equipado) equipado.raridade = item.raridade;

      const noCatalogo = CONFIG.catalogo.find(c => c.databaseId === item.databaseId);
      if (noCatalogo) noCatalogo.raridade = item.raridade;

      renderDetalheEquipamento(item);
      renderSlots();
      renderSinergia();
      renderBonus();
      atualizarAnalise();
      if (!$('pop').hidden) renderCatalogo();
    };
  });
}

/* ---------- carrossel de heróis ---------- */
function renderHerois() {
  const tk = $('track');

  tk.innerHTML = CONFIG.herois.map(h => `
    <div class="hcard ${h.id === heroiAtual ? 'on' : ''}" data-id="${esc(h.id)}">
      <div class="im">
        <div class="media ${h.media && h.media.src ? '' : 'ph'}" style="${mStyle(h.media)}">${mInner(h.media)}</div>
        <div class="fd"></div>
      </div>
      <div class="cp"><b>${esc(h.nome)}</b><i style="color:${esc(h.cor)}">${esc(h.classe)}</i></div>
    </div>`).join('');

  tk.onclick = e => {
    const c = e.target.closest('.hcard');
    if (!c) return;

    heroiAtual = c.dataset.id;
    const h = CONFIG.herois.find(x => x.id === heroiAtual);

    if (h) {
      CONFIG.heroi.id = h.id;
      CONFIG.heroi.databaseId = h.databaseId;
      CONFIG.heroi.nome = String(h.nome).toUpperCase();
      CONFIG.heroi.classe = h.classe;

      if (h.destaque && h.destaque.src) {
        CONFIG.heroi.media = Object.assign({}, h.destaque);
      } else if (h.media && h.media.src) {
        CONFIG.heroi.media = Object.assign({}, h.media, { fit: 'contain' });
      }
      CONFIG.heroi.cardMedia = h.media?.src
        ? Object.assign({}, h.media)
        : Object.assign({}, CONFIG.heroi.media, { fit: 'cover' });

      renderHeroi();
      CONFIG.resumo.tagA = h.classe;
      renderBonus();
      atualizarAnalise();
      if (!$('b-name').value.trim()) $('b-name').value = `${h.nome} — Build tática`;
      $('c-name').textContent = $('b-name').value.length;
      fecharSeletorHeroi();
      toast(`${h.nome} selecionado.`, 'success');
    }

    tk.querySelectorAll('.hcard').forEach(x => x.classList.toggle('on', x === c));
    progresso(2);
  };

  const n = Math.max(1, Math.ceil(CONFIG.herois.length / 5));
  $('dots').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('');
}

/* ---------- stats / sinergia / bônus ---------- */
function renderStats() {
  const alvo = $('stats');
  if (!alvo) return;

  alvo.innerHTML = CONFIG.macros.map(s => `
    <div class="stat">
      <div class="h">
        <span class="ic">${esc(s.icone)}</span>
        <span class="nm">${esc(s.nome)}</span>
        <span class="v">${s.valor.toLocaleString('pt-BR')}</span>
        <span class="d">${s.delta >= 0 ? '+' : ''}${s.delta}%</span>
      </div>
      <div class="tr"><i style="width:${s.pct.toFixed(1)}%;background:${esc(s.cor)};box-shadow:0 0 8px ${esc(s.cor)}66"></i></div>
    </div>`).join('');
}

function renderImpacto(resultado) {
  const grid = $('impact-grid');
  if (!grid) return;

  const linhas = resultado?.linhas || [];
  if (!linhas.length) return;

  grid.innerHTML = linhas.slice(0, 5).map(linha => {
    const delta = Number(linha.delta || 0);
    const negativo = Number(linha.beneficialDelta ?? delta) < 0;
    const mudou = Math.abs(Number(linha.difference || 0)) > 1e-9;
    return `<article class="real-stat-card ${negativo ? 'negative' : ''} ${mudou ? 'changed' : 'unchanged'}" style="--stat-color:${esc(linha.cor)}">
      <div class="real-stat-title"><span>${esc(linha.icone)}</span><h3>${esc(linha.nome)}</h3><i>OFICIAL</i></div>
      <div class="real-stat-current">
        <small>VALOR ATUAL</small>
        <div><b>${formatImpactValue(linha, linha.valor)}</b>${mudou ? `<strong class="${negativo ? 'penalty' : ''}">${
          linha.difference > 0 ? '+' : ''}${formatImpactDelta(linha, linha.difference)}</strong>` : ''}</div>
      </div>
      <div class="real-stat-base"><span>BASE SEM ITENS</span><b>${formatImpactValue(linha, linha.base)}</b>${mudou
        ? `<em>${delta >= 0 ? '+' : ''}${formatPercent(delta)}%</em>` : '<em>SEM ALTERAÇÃO</em>'}</div>
    </article>`;
  }).join('');

  const alteradas = resultado?.estatisticas?.filter(l => Math.abs(Number(l.difference)) > 1e-9) || [];
  const dica = alteradas.length
    ? `${alteradas.length} atributo(s) oficial(is) alterado(s). Abra “Detalhes” para auditar todos os valores.`
    : 'Nenhum atributo oficial foi alterado pelos equipamentos selecionados.';
  if ($('tactical-tip')) $('tactical-tip').textContent = dica;
  if ($('recommendation-copy')) $('recommendation-copy').textContent = dica;
  renderHeroBaseStats();
}

function formatPercent(value) {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  return rounded.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function formatImpactValue(linha, value) {
  const decimals = Number(linha.decimals || 0);
  const formatted = Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return `${esc(linha.prefix || '')}${formatted}${esc(linha.unit || '')}`;
}

function formatImpactDelta(linha, value) {
  const decimals = Number(linha.decimals || 0);
  const formatted = Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  return `${formatted}${esc(linha.unit || '')}`;
}

/* Recalcula tudo que depende do loadout. Ponto único de atualização. */
function atualizarAnalise() {
  try {
    const resultado = analisarBuild({
      heroi: CONFIG.heroi,
      slots: CONFIG.slots,
      equipados: CONFIG.equipados,
      dados: CONFIG.dados
    });

    CONFIG.analise = resultado;
    CONFIG.macros = resultado.linhas || [];

    renderAnalise(resultado);
    renderImpacto(resultado);
  } catch (error) {
    console.error('[criar-build] Erro ao atualizar análise:', error);

    CONFIG.analise = {
      status: 'error',
      mensagem: 'Não foi possível calcular a análise.',
      linhas: [],
      bonusAtivos: [],
      estatisticasDesconhecidas: []
    };

    CONFIG.macros = [];
    renderAnalise(CONFIG.analise);
    renderImpacto(CONFIG.analise);
  }

  renderStats();
}

function renderSinergia() {
  if (!$('syn')) return;
  $('syn').innerHTML = CONFIG.slots.map(s => {
    const it = CONFIG.equipados[s.key];
    return `<div class="s media ${it && it.media && it.media.src ? '' : 'ph'}"
      style="--rc:${esc(corDoItem(it))};${mStyle(it && it.media)}" title="${esc(s.label)}">${mInner(it && it.media)}</div>`;
  }).join('');
}

/* Bônus ativos = bônus de conjunto realmente atingidos pelo loadout. */
function bonusAtivos() {
  const contagem = new Map();
  Object.values(CONFIG.equipados).forEach(it => {
    if (!it?.setId) return;
    contagem.set(it.setId, (contagem.get(it.setId) || 0) + 1);
  });

  const ativos = [];
  const vistos = new Set();

  Object.values(CONFIG.equipados).forEach(it => {
    if (!it?.set || vistos.has(it.setId)) return;
    vistos.add(it.setId);
    const pecas = contagem.get(it.setId) || 0;
    (it.set.bonus || [])
      .filter(b => pecas >= (b.required_pieces || 0))
      .forEach(b => ativos.push({ nome: b.title, desc: b.description, icone: '◈' }));
  });

  return ativos;
}

function renderBonus() {
  CONFIG.bonus = bonusAtivos();
  if (!$('bonus')) return;
  if ($('bn-count')) $('bn-count').textContent = CONFIG.bonus.length;

  $('bonus').innerHTML = CONFIG.bonus.length
    ? CONFIG.bonus.map(b => `
      <div class="b"><span class="ic">${esc(b.icone)}</span>
        <div><b>${esc(b.nome)}</b><small>${esc(b.desc)}</small></div></div>`).join('')
    : '<div style="font-size:11.5px;color:var(--faint)">Complete peças de um mesmo conjunto para ativar bônus.</div>';

  if ($('sum-a')) $('sum-a').textContent = CONFIG.resumo.tagA;
  if ($('sum-b')) $('sum-b').textContent = CONFIG.resumo.tagB;
  if ($('sum-txt')) $('sum-txt').textContent = CONFIG.resumo.texto;
}

/* ---------- etapas / progresso ---------- */
function destacarEtapa(n) {
  const atual = Math.max(1, Math.min(4, Number(n) || 1));
  document.querySelectorAll('.step').forEach(s => {
    const i = +s.dataset.s;
    s.classList.toggle('on', i === atual);
    s.setAttribute('aria-current', i === atual ? 'step' : 'false');
  });
}

function progresso(n) {
  if (n > etapa) etapa = n;
  const pct = Math.min(100, etapa * 25);
  $('prog-pct').textContent = pct + '%';
  $('prog-bar').style.width = pct + '%';
  document.querySelectorAll('.step').forEach(s => {
    const i = +s.dataset.s;
    s.classList.toggle('done', i < etapa);
  });
  destacarEtapa(Math.min(n, 4));
}

function toast(mensagem, tipo = '') {
  const stack = $('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${tipo}`.trim();
  el.textContent = mensagem;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function dadosDaBuild(status = 'published') {
  return {
    heroId: CONFIG.heroi.databaseId,
    title: $('b-name').value.trim(),
    description: $('b-desc').value.trim(),
    visibility: $('b-vis').value,
    status,
    tags: [...CONFIG.tags],
    items: CONFIG.slots.map((slot, index) => {
      const item = CONFIG.equipados[slot.key];
      if (!item) return null;
      return {
        equipment_id: item.databaseId,
        tier_id: CONFIG.tiers.get(item.raridade)?.id || null,
        slot: index + 1
      };
    }).filter(Boolean)
  };
}

function salvarLocal(status = 'draft') {
  const draft = { ...dadosDaBuild(status), savedAt: new Date().toISOString() };
  localStorage.setItem('echo-arena-build-draft', JSON.stringify(draft));
  return draft;
}

async function salvarBuild(status = 'published') {
  const payload = dadosDaBuild(status);
  if (!payload.title) {
    $('b-name').focus();
    toast('Digite um nome para a build.', 'error');
    return;
  }
  if (!payload.heroId) {
    toast('Selecione um herói antes de salvar.', 'error');
    return;
  }

  const button = status === 'draft' ? $('save-draft') : $('save-build');
  if (button) button.disabled = true;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      salvarLocal(status);
      toast('Rascunho salvo neste dispositivo. Entre na conta para publicar.', 'success');
      return;
    }

    const isPublic = payload.visibility === 'public' && status === 'published';
    const visibility = payload.visibility === 'unlisted' ? 'private' : payload.visibility;
    const { data: build, error } = await supabase.from('builds').insert({
      user_id: session.user.id,
      hero_id: payload.heroId,
      title: payload.title,
      description: payload.description,
      is_public: isPublic,
      visibility,
      status,
      published_at: isPublic ? new Date().toISOString() : null
    }).select('id').single();
    if (error) throw error;

    const rows = payload.items.map(item => {
      const row = { build_id: build.id, equipment_id: item.equipment_id, slot: item.slot };
      if (item.tier_id) row.tier_id = item.tier_id;
      return row;
    });
    if (rows.length) {
      const { error: itemError } = await supabase.from('build_items').insert(rows);
      if (itemError) {
        await supabase.from('builds').delete().eq('id', build.id);
        throw itemError;
      }
    }

    localStorage.removeItem('echo-arena-build-draft');
    toast(status === 'draft' ? 'Rascunho salvo no seu perfil.' : 'Build publicada com sucesso.', 'success');
  } catch (error) {
    console.error('[criar-build] Falha ao salvar:', error);
    salvarLocal('draft');
    toast(`Não foi possível publicar: ${error.message}. Um rascunho local foi preservado.`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function abrirSeletorHeroi() {
  $('hero-picker').hidden = false;
  $('hero-picker-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharSeletorHeroi() {
  $('hero-picker').hidden = true;
  $('hero-picker-backdrop').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- eventos ---------- */
function adicionarEvento(id, evento, callback) {
  const elemento = document.getElementById(id);

  if (!elemento) {
    console.warn(`[criar-build] Elemento #${id} não encontrado.`);
    return;
  }

  elemento.addEventListener(evento, callback);
}

adicionarEvento('steps', 'click', e => {
  const s = e.target.closest('.step');
  if (s) destacarEtapa(+s.dataset.s);
});

adicionarEvento('next-equip', 'click', () => {
  progresso(4);
  document.querySelector('.col4')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

adicionarEvento('clear-all', 'click', () => {
  CONFIG.equipados = {};
  equipamentoSelecionado = null;
  renderSlots();
  renderSinergia();
  renderBonus();
  renderDetalheEquipamento(null);
  atualizarAnalise();
  if (!$('pop').hidden) { $('pop-foot').hidden = true; renderCatalogo(); }
  toast('Todos os equipamentos foram removidos.');
});

adicionarEvento('tk-l', 'click', () => $('track')?.scrollBy({ left: -300, behavior: 'smooth' }));
adicionarEvento('tk-r', 'click', () => $('track')?.scrollBy({ left: 300, behavior: 'smooth' }));

adicionarEvento('pop-close', 'click', fecharPop);
$('pop-back').onclick = fecharPop;

$('pop-clear').onclick = () => {
  if (!slotAtivo) return;
  limparSlot(slotAtivo);
  $('pop-foot').hidden = true;
};

$('pop-search').oninput = e => { buscaPop = e.target.value; renderCatalogo(); };

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('pop').hidden) fecharPop();
  if (e.key === 'Escape' && !$('hero-picker').hidden) fecharSeletorHeroi();
});

window.addEventListener('scroll', posicionarPop, { passive: true });

$('b-name').oninput = e => {
  $('c-name').textContent = e.target.value.length;
  if (e.target.value) progresso(1);
  salvarLocal('draft');
};

$('b-desc').oninput = e => { $('c-desc').textContent = e.target.value.length; salvarLocal('draft'); };

$('b-vis').onchange = e => {
  const mensagens = {
    public: 'Sua build poderá ser vista por todos.',
    unlisted: 'Somente pessoas com o link poderão acessar.',
    private: 'Somente você poderá ver esta build.'
  };
  $('vis-hint').textContent = mensagens[e.target.value] || mensagens.private;
  const radio = document.querySelector(`.vis-radio[value="${CSS.escape(e.target.value)}"]`);
  if (radio) radio.checked = true;
};

$('burger').onclick = () => {
  const aberto = $('side').classList.toggle('open');
  document.querySelector('.drawer-backdrop')?.classList.toggle('open', aberto);
  $('burger').setAttribute('aria-expanded', String(aberto));
};

document.querySelectorAll('[data-close-menu]').forEach(el => el.onclick = () => {
  $('side').classList.remove('open');
  document.querySelector('.drawer-backdrop')?.classList.remove('open');
  $('burger').setAttribute('aria-expanded', 'false');
});

document.querySelectorAll('.vis-radio').forEach(radio => radio.onchange = () => {
  $('b-vis').value = radio.value;
  $('b-vis').dispatchEvent(new Event('change'));
});

adicionarEvento('change-hero', 'click', abrirSeletorHeroi);
adicionarEvento('hero-picker-close', 'click', fecharSeletorHeroi);
adicionarEvento('hero-picker-backdrop', 'click', fecharSeletorHeroi);
adicionarEvento('save-build', 'click', () => salvarBuild('published'));
adicionarEvento('save-draft', 'click', () => salvarBuild('draft'));

adicionarEvento('share-build', 'click', async () => {
  const title = $('b-name').value.trim() || `Build de ${CONFIG.heroi.nome}`;
  const data = { title: `Echo Arena — ${title}`, text: 'Confira esta build do Echo Arena.', url: location.href };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(location.href); toast('Link copiado.', 'success'); }
  } catch (error) {
    if (error?.name !== 'AbortError') toast('Não foi possível compartilhar agora.', 'error');
  }
});

adicionarEvento('compare-build', 'click', () => {
  salvarLocal('compare');
  toast('Build adicionada ao comparador.', 'success');
});

document.querySelectorAll('[data-impact-tab]').forEach(tab => tab.onclick = () => {
  document.querySelectorAll('[data-impact-tab]').forEach(x => x.classList.toggle('on', x === tab));
  document.querySelectorAll('[data-impact-view]').forEach(view => view.classList.toggle('on', view.id === tab.dataset.impactTab));
});

document.querySelectorAll('#build-tags [data-tag]').forEach(button => {
  button.classList.add('selected');
  button.onclick = () => {
    const tag = button.dataset.tag;
    if (CONFIG.tags.has(tag)) { CONFIG.tags.delete(tag); button.classList.remove('selected'); }
    else { CONFIG.tags.add(tag); button.classList.add('selected'); }
  };
});

document.querySelector('#build-tags .add-tag')?.addEventListener('click', () => {
  const tag = prompt('Digite uma tag curta para a build:')?.trim();
  if (!tag || CONFIG.tags.has(tag)) return;
  CONFIG.tags.add(tag);
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.tag = tag; button.className = 'selected'; button.textContent = tag;
  button.onclick = () => { CONFIG.tags.delete(tag); button.remove(); };
  document.querySelector('#build-tags .add-tag').before(button);
});

document.querySelectorAll('.mobile-steps .step').forEach(step => step.addEventListener('click', () => {
  const numero = Number(step.dataset.s);
  const alvo = numero === 1 ? document.querySelector('.hero-panel')
    : numero === 2 ? document.querySelector('.synergy-stage')
    : numero === 3 ? document.querySelector('.impact-panel')
    : document.querySelector('.build-plan');
  alvo?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// Mantém o navegador de etapas sincronizado com a seção realmente visível.
// A página continua única; os números funcionam como atalhos, não como páginas separadas.
const secoesEtapas = [
  { n: 1, el: document.querySelector('.hero-panel') },
  { n: 2, el: document.querySelector('.synergy-stage') },
  { n: 3, el: document.querySelector('.impact-panel') },
  { n: 4, el: document.querySelector('.build-plan') }
].filter(item => item.el);

let scrollSpyTimer = null;
function sincronizarEtapaComScroll() {
  if (!window.matchMedia('(max-width:800px)').matches) return;
  const referencia = window.innerHeight * 0.42;
  let melhor = secoesEtapas[0];
  let distancia = Infinity;
  secoesEtapas.forEach(item => {
    const rect = item.el.getBoundingClientRect();
    const ponto = Math.max(rect.top, Math.min(referencia, rect.bottom));
    const d = Math.abs(ponto - referencia);
    if (rect.bottom > 70 && rect.top < window.innerHeight && d < distancia) {
      distancia = d;
      melhor = item;
    }
  });
  if (melhor) destacarEtapa(melhor.n);
}

window.addEventListener('scroll', () => {
  clearTimeout(scrollSpyTimer);
  scrollSpyTimer = setTimeout(sincronizarEtapaComScroll, 45);
}, { passive: true });

let resizeTimer = null;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(() => {
    renderSlots();

    if (typeof posicionarPop === 'function') {
      posicionarPop();
    }
  }, 200);
});

/* ---------- init ---------- */
try {
  await carregarConteudoSupabase();
  CONFIG.dados = await carregarDadosAnalise();
} catch (err) {
  console.error('Falha ao carregar conteúdo do Supabase:', err);
}

try {
  const draft = JSON.parse(localStorage.getItem('echo-arena-build-draft') || 'null');
  if (draft) {
    const hero = CONFIG.herois.find(h => h.databaseId === draft.heroId);
    if (hero) {
      CONFIG.heroi = {
        id: hero.id, databaseId: hero.databaseId, nome: String(hero.nome).toUpperCase(),
        classe: hero.classe, media: hero.destaque?.src ? hero.destaque : hero.media
      };
    }
    for (const salvo of (draft.items || [])) {
      const slot = CONFIG.slots[Number(salvo.slot) - 1];
      const item = CONFIG.catalogo.find(i => i.databaseId === salvo.equipment_id);
      if (slot && item) CONFIG.equipados[slot.key] = { ...item };
    }
    $('b-name').value = draft.title || '';
    $('b-desc').value = draft.description || '';
    $('b-vis').value = draft.visibility || 'public';
  }
} catch (error) {
  console.warn('[criar-build] Rascunho local inválido:', error);
}

if (!$('b-name').value) $('b-name').value = `${CONFIG.heroi.nome || 'Herói'} — Controle de Longo Alcance`;
$('c-name').textContent = $('b-name').value.length;
$('c-desc').textContent = $('b-desc').value.length;
$('b-vis').dispatchEvent(new Event('change'));

heroiAtual = CONFIG.heroi.id;
CONFIG.resumo.tagA = CONFIG.heroi.classe || '—';

renderHeroi();
renderHerois();
renderDetalheEquipamento(null);
renderSinergia();
renderBonus();
atualizarAnalise();
progresso(1);

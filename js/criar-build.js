import { supabase } from './supabase.js';
import {
  RARIDADES, esc, cssSafe, numSafe, srcSafe, isVid,
  mStyle, mInner, normalizar, rc, rn,
  nivelAtual, nomeDoNivel, corDoItem, pintar
} from './ui-core.js';
import { carregarDadosAnalise, analisarBuild, renderAnalise } from './build-analise.js';

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
  heroi:   { id: '', nome: '—', classe: '', media: { src: '', fit: 'contain' } },
  slots:   SLOTS_PADRAO.map((s, i, a) => ({ ...s, ...posicaoAnel(i, a.length) })),
  equipados: {},
  analise: null,
  herois: [],
  catalogo: [],

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

/* ============================================================
   SUPABASE — conteúdo administrável
   ============================================================ */
async function carregarConteudoSupabase() {
  const [
    heroesResult, classesResult, equipmentsResult, slotsResult,
    rarityLevelsResult, equipmentSetsResult, setBonusesResult
  ] = await Promise.all([
    supabase.from('heroes').select(`
        id, name, slug, class_id, enabled, display_order,
        image_path, card_image_path, gif_path,
        image_url, card_image_url, gif_url,
        image_fit, image_position, image_scale, image_offset_x, image_offset_y
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

    supabase.from('equipment_sets').select('id,name,slug,description,image_path'),

    supabase.from('equipment_set_bonuses')
      .select('id,set_id,required_pieces,title,description,display_order')
      .order('required_pieces', { ascending: true })
      .order('display_order', { ascending: true })
  ]);

  const falhas = [
    ['heróis', heroesResult], ['classes', classesResult], ['equipamentos', equipmentsResult],
    ['slots', slotsResult], ['níveis', rarityLevelsResult],
    ['conjuntos', equipmentSetsResult], ['bônus de conjunto', setBonusesResult]
  ].filter(([, r]) => r.error);

  falhas.forEach(([nome, r]) => console.error(`Erro ao carregar ${nome}:`, r.error));

  const classes = new Map((classesResult.data || []).map(i => [i.id, i]));
  const sets = new Map((equipmentSetsResult.data || []).map(i => [i.id, i]));
  const slotsPorId = new Map((slotsResult.data || []).map(i => [i.id, i]));

  const rarityLevels = new Map();
  for (const level of (rarityLevelsResult.data || [])) {
    if (!rarityLevels.has(level.equipment_id)) rarityLevels.set(level.equipment_id, []);
    rarityLevels.get(level.equipment_id).push(level);
  }

  const setBonuses = new Map();
  for (const bonus of (setBonusesResult.data || [])) {
    if (!setBonuses.has(bonus.set_id)) setBonuses.set(bonus.set_id, []);
    setBonuses.get(bonus.set_id).push(bonus);
  }

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
      media: first.destaque
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
  renderSlots();
}

function renderSlots() {
  const ring = $('ring');
  ring.querySelectorAll('.slot').forEach(s => s.remove());

  const mob = $('slots-mobile');
  mob.innerHTML = '';

  const mobile = window.matchMedia('(max-width:720px)').matches;

  CONFIG.slots.forEach(s => {
    const it = CONFIG.equipados[s.key];
    const el = document.createElement('div');
    el.className = 'slot' + (it ? '' : ' empty') + (slotAtivo === s.key ? ' active' : '');
    el.dataset.slot = s.key;
    el.style.setProperty('--rc', corDoItem(it));

    el.innerHTML =
      `<div class="lb">${esc(s.label)}</div>` +
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

    if (mobile) {
      mob.appendChild(el);
    } else {
      el.style.position = 'absolute';
      el.style.left = s.x + '%';
      el.style.top = s.y + '%';
      el.style.transform = 'translate(-50%,-50%)';
      ring.appendChild(el);
    }
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
  progresso(3);
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
  progresso(3);
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

  if (!item) {
    equipamentoSelecionado = null;
    detail.className = 'eq-detail empty';
    detail.textContent = 'Toque num slot ao redor do herói para escolher e ver níveis, atributos e bônus do conjunto.';
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

      renderHeroi();
      CONFIG.resumo.tagA = h.classe;
      renderBonus();
      atualizarAnalise();
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
function progresso(n) {
  if (n > etapa) etapa = n;
  const pct = Math.min(100, etapa * 25);
  $('prog-pct').textContent = pct + '%';
  $('prog-bar').style.width = pct + '%';
  document.querySelectorAll('.step').forEach(s => {
    const i = +s.dataset.s;
    s.classList.toggle('on', i === etapa);
    s.classList.toggle('done', i < etapa);
  });
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
  if (s) progresso(+s.dataset.s);
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
});

window.addEventListener('scroll', posicionarPop, { passive: true });

$('b-name').oninput = e => {
  $('c-name').textContent = e.target.value.length;
  if (e.target.value) progresso(1);
};

$('b-desc').oninput = e => { $('c-desc').textContent = e.target.value.length; };

$('b-vis').onchange = e => {
  $('vis-hint').textContent = e.target.value === 'public'
    ? 'Sua build poderá ser vista por todos.'
    : 'Somente você poderá ver esta build.';
};

$('burger').onclick = () => $('side').classList.toggle('open');

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

heroiAtual = CONFIG.heroi.id;
CONFIG.resumo.tagA = CONFIG.heroi.classe || '—';

renderHeroi();
renderHerois();
renderDetalheEquipamento(null);
renderSinergia();
renderBonus();
atualizarAnalise();
progresso(1);

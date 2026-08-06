import { supabase } from './supabase.js';
import { esc, mStyle, mInner, corDoItem, normalizar } from './ui-core.js';

/* ============================================================
   ANÁLISE DA BUILD
   analisarBuild(contexto) -> só calcula, nunca toca no DOM.
   renderAnalise(resultado) -> só desenha, nunca calcula.
   ============================================================ */

/* ---------- TABELA DE AJUSTE 1: macro-atributos ----------
   teto = pontuação bruta que enche 100% do eixo do radar. */
export const MACROS = [
  { key: 'fogo',          nome: 'Poder de fogo',  curto: 'FOGO',     icone: '🚀', cor: '#FF5470', teto: 10000 },
  { key: 'sobrevivencia', nome: 'Sobrevivência',  curto: 'SOBREV.',  icone: '🛡', cor: '#4ADE80', teto: 10000 },
  { key: 'mobilidade',    nome: 'Mobilidade',     curto: 'MOBIL.',   icone: '⚡', cor: '#FBBF24', teto: 10000 },
  { key: 'precisao',      nome: 'Precisão',       curto: 'PRECIS.',  icone: '◎', cor: '#5B8DEF', teto: 10000 },
  { key: 'controle',      nome: 'Controle',       curto: 'CONTROLE', icone: '✧', cor: '#A855F7', teto: 10000 }
];

/* ---------- TABELA DE AJUSTE 2: stat cru -> macro ----------
   [macro, pontos por unidade do stat]. Uma stat pode alimentar
   mais de um macro. Chave fora daqui é ignorada e devolvida em
   estatisticasDesconhecidas. */
export const STAT_MAP = {
  /* --- arma (hero_weapon_stats) --- */
  weapon_damage:            [['fogo', 1]],
  fire_rate:                [['fogo', 1500]],
  fire_interval:            [['fogo', 300, 'inv']],
  magazine_size:            [['fogo', 120]],
  reload_time:              [['fogo', 400, 'inv']],
  weapon_armor_penetration: [['fogo', 12]],
  armor_penetration_power:  [['fogo', 25]],
  weapon_range:             [['controle', 1.5]],
  weapon_spread:            [['precisao', 400, 'inv']],
  spread_factor:            [['precisao', 400, 'inv']],
  moving_spread_modifier:   [['precisao', 300, 'inv']],
  aim_time:                 [['precisao', 300, 'inv']],

  /* --- status do herói (hero_base_stats) --- */
  health:         [['sobrevivencia', 1]],
  armor:          [['sobrevivencia', 90]],
  movement_speed: [['mobilidade', 20]],
  vision_range:   [['controle', 1]],

  /* --- equipamento, chaves em português ---
     A busca é feita com o texto normalizado (minúsculo, sem
     acento), então "Dispersão de tiro" e "dispersao de tiro"
     caem na mesma regra. Valor negativo = redução; para stats
     onde reduzir é bom, o peso também é negativo, e o produto
     vira contribuição positiva. */
  'dispersao de tiro da arma sem mirar': [['precisao', -30]],
  'dispersao de tiro da arma':           [['precisao', -30]],
  'velocidade para pegar melhorias':     [['mobilidade', -18]],

  /* --- equipamento, chaves em inglês já existentes --- */
  /* '_pct' são percentuais sobre o próprio herói: modo 'pct'
     aplica o valor como % da base daquele macro, em vez de somar
     um número fixo. +7% de dano vale mais numa arma forte. */
  weapon_damage_to_armor_pct:   [['fogo', 1, 'pct']],
  weapon_damage_to_health_pct:  [['fogo', 1, 'pct']],
  special_ability_cooldown_pct: [['precisao', -1, 'pct']],
  crate_opening_cooldown_pct:   [['mobilidade', -1, 'pct']],
  weapon_range_franco:          [['fogo', 60], ['controle', 90]],
};

/* Chaves reconhecidas mas deliberadamente fora do cálculo.
   'power' é o número agregado que o jogo já exibe: somá-lo
   contaria a arma duas vezes. */
export const STAT_IGNORADAS = new Set(['power']);

/* ---------- TABELA DE AJUSTE 3: multiplicador por nível do herói ---------- */
export const NIVEL_MULT = {
  comum: 1.00, raro: 1.10, epico: 1.22, lendario: 1.35, mitico: 1.48,
  supremo: 1.60, grandioso: 1.72, celestial: 1.84, estelar: 1.94,
  imortal: 2.05, divino: 2.20
};

/* ---------- TABELA DE AJUSTE 4: limiares dos chips ----------
   Relativos à média dos eixos da própria build, não ao teto:
   o teto carrega folga para equipamento, então comparar com ele
   tornava "forte" inalcançável e marcava quase tudo como fraco. */
export const LIMIAR_FORTE = 1.20;
export const LIMIAR_FRACO = 0.70;

/* Mantida para calibragem futura. NÃO entra em cálculo nenhum:
   sem hero_base_stats o painel avisa em vez de inventar número. */
export const BASE_FALLBACK = {
  fogo: 4200, sobrevivencia: 4500, mobilidade: 3900, suporte: 3400, controle: 4000
};

const criarResultadoVazio = (status = 'idle', mensagem = '') => ({
  status,
  mensagem,
  base: null,
  total: null,
  linhas: [],
  fortes: [],
  fracos: [],
  bonusAtivos: [],
  sinergia: [],
  estilo: null,
  dificuldade: null,
  estado: null,
  classe: null,
  equipadosN: 0,
  totalSlots: 0,
  estatisticasDesconhecidas: []
});

/* ============================================================
   CARGA ISOLADA — colunas que talvez ainda não existam.
   Cada query vai sozinha e num try/catch para que a ausência
   de uma coluna não derrube o carregamento da página inteira.
   ============================================================ */
/* Teto por macro calculado a partir do maior valor observado entre
   todos os heróis, mais folga para o que os equipamentos somam.
   Evita teto chutado à mão saturando ou achatando o radar. */
export const FOLGA_TETO = 1.6;

function calcularTetos(baseHerois) {
  const tetos = {};
  const ignorar = new Set();

  for (const stats of baseHerois.values()) {
    const pontos = Object.fromEntries(MACROS.map(m => [m.key, 0]));
    acumular(pontos, stats, ignorar);
    for (const m of MACROS) {
      tetos[m.key] = Math.max(tetos[m.key] || 0, pontos[m.key] || 0);
    }
  }

  for (const m of MACROS) {
    tetos[m.key] = Math.round((tetos[m.key] || 0) * FOLGA_TETO) || m.teto;
  }
  return tetos;
}

export async function carregarDadosAnalise() {
  const dados = { baseHerois: new Map(), textos: new Map(), statsBonus: new Map(), tetos: {} };

  /* A view hero_complete_base_stats já entrega status e arma
     juntos, um registro por herói. Se ela não existir, cai na
     leitura linha a linha das duas tabelas. */
  try {
    const { data, error } = await supabase.from('hero_complete_base_stats')
      .select('hero_id,hero_stats,weapon_stats');
    if (error) throw error;

    for (const linha of (data || [])) {
      if (!linha.hero_id) continue;
      dados.baseHerois.set(linha.hero_id, {
        ...(linha.hero_stats || {}),
        ...(linha.weapon_stats || {})
      });
    }
  } catch (err) {
    console.warn('[build-analise] view hero_complete_base_stats indisponível, lendo tabelas:', err?.message || err);

    for (const tabela of ['hero_base_stats', 'hero_weapon_stats']) {
      try {
        const { data, error } = await supabase.from(tabela).select('hero_id,stat_key,value');
        if (error) throw error;
        for (const linha of (data || [])) {
          if (!linha.hero_id || !linha.stat_key) continue;
          if (!dados.baseHerois.has(linha.hero_id)) dados.baseHerois.set(linha.hero_id, {});
          dados.baseHerois.get(linha.hero_id)[linha.stat_key] = Number(linha.value ?? 0);
        }
      } catch (e) {
        console.warn(`[build-analise] ${tabela} indisponível:`, e?.message || e);
      }
    }
  }

  dados.tetos = calcularTetos(dados.baseHerois);

  try {
    const { data, error } = await supabase.from('heroes')
      .select('id,playstyle,difficulty,strength_note,weakness_note');
    if (error) throw error;
    for (const h of (data || [])) dados.textos.set(h.id, h);
  } catch (err) {
    console.warn('[build-analise] textos de análise do herói ausentes:', err?.message || err);
  }

  try {
    const { data, error } = await supabase.from('equipment_set_bonuses').select('id,stats');
    if (error) throw error;
    for (const b of (data || [])) if (b.stats) dados.statsBonus.set(b.id, b.stats);
  } catch (err) {
    console.warn('[build-analise] equipment_set_bonuses.stats ausente:', err?.message || err);
  }

  return dados;
}

/* ============================================================
   CÁLCULO
   ============================================================ */
function acumular(alvo, stats, desconhecidas, mult = 1, base = null) {
  for (const [chave, valor] of Object.entries(stats || {})) {
    if (STAT_IGNORADAS.has(chave)) continue;

    const regras = STAT_MAP[chave] || STAT_MAP[normalizar(chave)];
    if (!regras) { desconhecidas.add(chave); continue; }

    const n = Number(valor);
    if (!Number.isFinite(n)) continue;

    for (const [macro, peso, modo] of regras) {
      /* 'inv': quanto menor o valor, melhor (recarga, dispersão,
         tempo de mira). Sem isso a arma pior pontuaria mais. */
      let contribuicao;
      if (modo === 'inv') {
        /* quanto menor o valor, melhor (recarga, dispersão, mira) */
        contribuicao = n > 0 ? peso / n : 0;
      } else if (modo === 'pct') {
        /* percentual sobre a base do herói naquele macro */
        contribuicao = base ? (base[macro] || 0) * (n / 100) * peso : 0;
      } else {
        contribuicao = n * peso;
      }

      alvo[macro] = (alvo[macro] || 0) + contribuicao * mult;
    }
  }
}

export function calcularBonusAtivos(contexto = {}) {
  const itens = Object.values(contexto.equipados || {}).filter(Boolean);

  const contagem = new Map();
  for (const item of itens) {
    if (item.setId) contagem.set(item.setId, (contagem.get(item.setId) || 0) + 1);
  }

  const ativos = [];
  const vistos = new Set();
  for (const item of itens) {
    if (!item.set || vistos.has(item.setId)) continue;
    vistos.add(item.setId);
    const pecas = contagem.get(item.setId) || 0;
    for (const b of (item.set.bonus || [])) {
      if (pecas < (b.required_pieces || 0)) continue;
      ativos.push({
        id: b.id,
        set: item.set.nome,
        pecas: b.required_pieces,
        titulo: b.title,
        desc: b.description
      });
    }
  }
  return ativos;
}

export function calcularMacros(contexto = {}) {
  /* Local de propósito: um Set de módulo carregaria chaves
     desconhecidas do herói anterior para a análise atual. */
  const desconhecidas = new Set();

  const { heroi = {}, equipados = {}, dados = {} } = contexto;
  const dadosHeroi = dados.baseHerois?.get(heroi.databaseId);

  const possuiBaseReal = Boolean(
    dadosHeroi &&
    typeof dadosHeroi === 'object' &&
    Object.keys(dadosHeroi).length
  );

  const base = possuiBaseReal ? dadosHeroi : null;

  if (!base) {
    return criarResultadoVazio(
      'missing-base',
      'As estatísticas-base deste herói ainda não foram cadastradas.'
    );
  }

  const mult = NIVEL_MULT[heroi.nivelSlug] ?? 1;

  const pontosBase = Object.fromEntries(MACROS.map(m => [m.key, 0]));
  acumular(pontosBase, base, desconhecidas, mult);

  const pontosTotal = { ...pontosBase };

  /* equipamentos: stats do nível escolhido */
  for (const item of Object.values(equipados).filter(Boolean)) {
    const level = item.levels?.find(l => l.slug === item.raridade) || item.levels?.[0];
    acumular(pontosTotal, level?.stats, desconhecidas, 1, pontosBase);
  }

  /* bônus de conjunto atingidos */
  for (const b of calcularBonusAtivos(contexto)) {
    acumular(pontosTotal, dados.statsBonus?.get(b.id), desconhecidas, 1, pontosBase);
  }

  const linhas = MACROS.map(m => {
    const teto = dados.tetos?.[m.key] || m.teto;
    const valorBase = Math.round(pontosBase[m.key] || 0);
    const valor = Math.round(pontosTotal[m.key] || 0);
    const pct = Math.max(0, Math.min(100, (valor / teto) * 100));
    const pctBase = Math.max(0, Math.min(100, (valorBase / teto) * 100));
    const delta = valorBase > 0 ? Math.round(((valor - valorBase) / valorBase) * 100) : 0;
    return { ...m, teto, base: valorBase, valor, pct, pctBase, delta };
  });

  return {
    status: 'ok',
    base: pontosBase,
    total: pontosTotal,
    linhas,
    estimado: false,
    estatisticasDesconhecidas: [...desconhecidas]
  };
}

/* Estimativa usada só quando heroes.difficulty está vazio.
   Build completa != build difícil: o que pesa é penalidade
   (delta negativo) somada a ganho concentrado. */
export function calcularDificuldade({ linhas = [], equipados = [] }) {
  if (!equipados.length) return null;

  const penalidades = linhas.filter(linha => {
    return Number(linha.delta) < 0;
  }).length;

  const ganhosConcentrados = linhas.filter(linha => {
    return Number(linha.pct) >= LIMIAR_FORTE;
  }).length;

  let nivel = 1;

  if (penalidades >= 2) nivel += 1;
  if (ganhosConcentrados >= 2 && penalidades >= 1) nivel += 1;

  return Math.min(3, nivel);
}

const ESTILO_DERIVADO = {
  fogo: 'Ofensivo — troca dano por exposição.',
  sobrevivencia: 'Resistente — segura linha de frente.',
  mobilidade: 'Móvel — reposiciona e flanqueia.',
  suporte: 'Utilitário — sustenta o time.',
  controle: 'Tático — domina alcance e visão.'
};

export function analisarBuild(contexto = {}) {
  try {
    if (!contexto.heroi?.databaseId) {
      return criarResultadoVazio(
        'waiting-hero',
        'Selecione um herói para iniciar a análise.'
      );
    }

    const resultadoMacros = calcularMacros(contexto);
    if (resultadoMacros.status !== 'ok') return resultadoMacros;

    const { heroi = {}, slots = [], equipados = {}, dados = {} } = contexto;
    const { linhas } = resultadoMacros;

    const itensEquipados = Object.values(equipados).filter(Boolean);
    const equipadosN = slots.filter(s => equipados[s.key]).length;
    const estado = equipadosN === 0 ? 'Aguardando build'
      : equipadosN < slots.length ? 'Parcial' : 'Completa';

    const texto = dados.textos?.get(heroi.databaseId) || {};

    const media = linhas.reduce((soma, l) => soma + l.pct, 0) / (linhas.length || 1);

    const rotulo = l => `${l.nome}: ${Math.round(l.pct)}% do teto`;
    const fortes = media > 0
      ? linhas.filter(l => l.pct >= media * LIMIAR_FORTE).map(rotulo) : [];
    const fracos = media > 0
      ? linhas.filter(l => l.pct <= media * LIMIAR_FRACO).map(rotulo) : [];
    if (texto.strength_note) fortes.push(texto.strength_note);
    if (texto.weakness_note) fracos.push(texto.weakness_note);

    const topo = [...linhas].sort((a, b) => b.pct - a.pct)[0];
    const derivado = ESTILO_DERIVADO[topo?.key] || 'Monte o loadout para definir o estilo.';
    const estilo = equipadosN === 0
      ? 'A análise será atualizada automaticamente conforme a montagem da build.'
      : (texto.playstyle ? `${texto.playstyle} ${derivado}` : derivado);

    const sinergia = slots.map(s => {
      const it = equipados[s.key];
      return { label: s.label, cor: corDoItem(it), media: it?.media || null, vazio: !it?.media?.src };
    });

    const resultado = {
      ...resultadoMacros,
      /* status vem DEPOIS do spread: calcularMacros devolve
         'ok' e sobrescreveria o 'ready' se viesse antes. */
      status: 'ready',
      mensagem: '',
      bonusAtivos: calcularBonusAtivos(contexto),
      fortes,
      fracos,
      sinergia,
      estilo,
      dificuldade: Number(texto.difficulty)
        || calcularDificuldade({ linhas, equipados: itensEquipados }),
      estado,
      classe: heroi.classe || null,
      equipadosN,
      totalSlots: slots.length
    };

    if (resultado.estatisticasDesconhecidas.length) {
      console.warn('[build-analise] Stats sem mapeamento em STAT_MAP:',
        resultado.estatisticasDesconhecidas.join(', '));
    }

    return resultado;
  } catch (error) {
    console.error('[build-analise] Falha ao analisar build:', error);

    return criarResultadoVazio(
      'error',
      'Não foi possível calcular a análise desta build.'
    );
  }
}

/* ============================================================
   RADAR (SVG, sem biblioteca)
   ============================================================ */
const CX = 132, CY = 122, R = 78;

function ponto(i, r) {
  const a = (-90 + i * (360 / MACROS.length)) * Math.PI / 180;

  return [
    CX + r * Math.cos(a),
    CY + r * Math.sin(a)
  ];
}

function poligono(pcts) {
  return pcts.map((p, i) => {
    const [x, y] = ponto(i, R * Math.max(0.02, Math.min(1, p / 100)));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function radarSvg(linhas) {
  const aneis = [25, 50, 75, 100].map(p =>
    `<polygon class="an-grid" points="${poligono(MACROS.map(() => p))}"></polygon>`).join('');

  const eixos = MACROS.map((m, i) => {
    const [x, y] = ponto(i, R);
    return `<line class="an-axis" x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"></line>`;
  }).join('');

  const rotulos = MACROS.map((m, i) => {
    const [x, y] = ponto(i, R + 20);
    const anchor = Math.abs(x - CX) < 6 ? 'middle' : (x > CX ? 'start' : 'end');
    return `<text class="an-label" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" fill="${m.cor}">${m.curto}</text>`;
  }).join('');

  const vertices = linhas.map((l, i) => {
    const [x, y] = ponto(i, R * Math.max(0.02, Math.min(1, l.pct / 100)));
    return `<circle class="an-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${l.cor}"></circle>`;
  }).join('');

  return `
    <svg class="an-radar" viewBox="0 0 264 244" role="img" aria-label="Radar dos atributos da build">
      ${aneis}${eixos}
      <polygon class="an-poly-base" points="${poligono(linhas.map(l => l.pctBase))}"></polygon>
      <polygon class="an-poly-total" points="${poligono(linhas.map(l => l.pct))}"></polygon>
      ${vertices}${rotulos}
    </svg>`;
}

/* ============================================================
   RENDER
   ============================================================ */
const cabecalho = (rotulo, classe = '') =>
  `<div class="an-head"><h2>Análise da Build</h2>
     <span class="an-state ${classe}">${esc(rotulo)}</span></div>`;

const aviso = (classe, titulo, texto) =>
  `<div class="an-message ${classe}"><strong>${esc(titulo)}</strong><p>${esc(texto)}</p></div>`;

export function renderAnalise(resultado) {
  const container = document.getElementById('analise');
  if (!container) return;

  /* Contrato: só entra aqui a saída de analisarBuild(). Um objeto
     sem status é o contexto cru sendo passado direto — falha em
     voz alta em vez de desenhar um painel vazio que parece pronto. */
  if (resultado && !resultado.status) {
    console.error(
      '[build-analise] renderAnalise recebeu um objeto sem status. ' +
      'Chame analisarBuild(contexto) e passe o resultado, não o contexto.',
      resultado
    );
    container.innerHTML = cabecalho('Erro', 'error') + aviso(
      'error', 'Análise recebeu dados inválidos',
      'O painel foi chamado com o contexto em vez do resultado do cálculo. Veja o console.'
    );
    return;
  }

  if (!resultado || resultado.status === 'waiting-hero' || resultado.status === 'idle') {
    container.innerHTML = cabecalho('Aguardando') + aviso(
      '', 'Selecione um herói',
      'Escolha um herói para visualizar estatísticas, sinergias e recomendações.'
    );
    return;
  }

  if (resultado.status === 'missing-base') {
    container.innerHTML = cabecalho('Dados pendentes', 'warning') + aviso(
      'warning', 'Estatísticas-base não cadastradas',
      'Este herói ainda não possui dados suficientes para gerar uma análise confiável.'
    );
    return;
  }

  if (resultado.status === 'error') {
    container.innerHTML = cabecalho('Erro', 'error') + aviso(
      'error', 'Não foi possível atualizar a análise',
      'A montagem foi preservada. Altere um item ou tente novamente para recalcular.'
    );
    return;
  }

  const {
    linhas = [], fortes = [], fracos = [], bonusAtivos = [], sinergia = [],
    estilo, dificuldade, estado, classe, equipadosN = 0, totalSlots = 0
  } = resultado;

  const chips = (lista, tipo, vazio) => lista.length
    ? lista.map(t => `<li class="an-chip ${tipo}">${esc(t)}</li>`).join('')
    : `<li class="an-chip vazio">${esc(vazio)}</li>`;

  container.innerHTML = `
    ${cabecalho(estado || 'Pronta', estado === 'Completa' ? 'ok' : '')}

    ${radarSvg(linhas)}

    <div class="an-legend">
      <span><i class="l-base"></i>Herói</span>
      <span><i class="l-total"></i>Com equipamentos</span>
    </div>

    <ul class="an-values">
      ${linhas.map(l => `
        <li style="--rc:${esc(l.cor)}">
          <span class="ic">${esc(l.icone)}</span>
          <span class="nm">${esc(l.curto)}</span>
          <b>${l.valor.toLocaleString('pt-BR')}</b>
          <i class="${l.delta >= 0 ? 'up' : 'down'}">${l.delta >= 0 ? '+' : ''}${l.delta}%</i>
        </li>`).join('')}
    </ul>

    <div class="an-syn" title="Sinergia dos itens">
      ${sinergia.map(s => `<div class="s media ${s.vazio ? 'ph' : ''}" style="--rc:${esc(s.cor)};${mStyle(s.media)}" title="${esc(s.label)}">${mInner(s.media)}</div>`).join('')}
    </div>

    <div class="an-grid2">
      <section>
        <h3>Pontos fortes</h3>
        <ul>${chips(fortes, 'up', 'Equipe itens para gerar a análise.')}</ul>
      </section>
      <section>
        <h3>Pontos fracos</h3>
        <ul>${chips(fracos, 'down', 'Aguardando dados suficientes da build.')}</ul>
      </section>
    </div>

    <section class="an-style">
      <h3>Estilo de jogo</h3>
      <p>${esc(estilo || '')}</p>
    </section>

    <div class="an-foot">
      <div>
        <h3>Dificuldade</h3>
        <div class="an-dif">${dificuldade
          ? Array.from({ length: 5 }, (_, i) => `<i class="${i < dificuldade ? 'on' : ''}"></i>`).join('')
          : '<span class="an-dif-empty">—</span>'}</div>
      </div>
      <div>
        <h3>Classe</h3>
        <span class="an-tag">${esc(classe || '—')}</span>
      </div>
      <div>
        <h3>Slots</h3>
        <span class="an-tag">${equipadosN}/${totalSlots}</span>
      </div>
    </div>

    <details class="an-bonus" ${bonusAtivos.length ? 'open' : ''}>
      <summary>Bônus ativos <b>${bonusAtivos.length}</b></summary>
      ${bonusAtivos.length
        ? bonusAtivos.map(b => `<div class="an-b"><span class="pc">${esc(b.pecas)}</span><div><b>${esc(b.titulo)}</b><small>${esc(b.desc)}</small></div></div>`).join('')
        : '<p class="an-empty">Complete peças de um mesmo conjunto para ativar bônus.</p>'}
    </details>
  `;
}

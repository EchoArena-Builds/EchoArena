import { supabase } from '../../js/supabase.js';

/* ============================================================
   Utilidades
   ============================================================ */

const $ = (id) => document.getElementById(id);

function showMessage(text, type = 'error') {
  const box = $('dashboard-message');
  if (!box) return;

  box.textContent = text;
  box.classList.remove('error', 'ok');
  box.classList.add('is-visible', type);
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/* Primeiro valor não vazio entre várias chaves possíveis.
   O schema tem variações de nome; isso evita quebrar por causa
   de uma coluna chamada diferente do esperado. */
function pick(row, ...keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function renderEmpty(container, text) {
  if (!container) return;
  container.innerHTML = `<div class="dashboard-empty">${escapeHtml(text)}</div>`;
}

/* ============================================================
   Acesso a dados
   ============================================================ */

async function countRows(table, filters = null) {
  let query = supabase
    .from(table)
    .select('id', { count: 'exact', head: true });

  if (filters) {
    for (const [column, value] of Object.entries(filters)) {
      query = query.eq(column, value);
    }
  }

  const { count, error } = await query;

  if (error) {
    console.warn(`[dashboard] contagem de ${table} falhou:`, error.message);
    return null;
  }

  return count ?? 0;
}

/* Busca registros recentes tentando ordenações em cascata,
   porque nem toda tabela tem created_at. */
async function fetchRecent(table, limit = 4) {
  const attempts = [
    { column: 'created_at', ascending: false },
    { column: 'id', ascending: false },
    null
  ];

  for (const order of attempts) {
    let query = supabase.from(table).select('*').limit(limit);

    if (order) {
      query = query.order(order.column, { ascending: order.ascending });
    }

    const { data, error } = await query;

    if (!error) return data ?? [];

    /* 42703 = coluna inexistente: tenta a próxima ordenação */
    if (error.code !== '42703') {
      console.warn(`[dashboard] leitura de ${table} falhou:`, error.message);
      return null;
    }
  }

  return null;
}

/* O projeto tem tabelas com nomes parecidos (equipments/equipment).
   Descobre qual responde antes de montar o bloco. */
let equipmentTableCache;

async function resolveEquipmentTable() {
  if (equipmentTableCache !== undefined) return equipmentTableCache;

  for (const candidate of ['equipments', 'equipment']) {
    const { error } = await supabase
      .from(candidate)
      .select('id', { count: 'exact', head: true });

    if (!error) {
      equipmentTableCache = candidate;
      return candidate;
    }
  }

  equipmentTableCache = null;
  return null;
}

/* ============================================================
   Métricas
   ============================================================ */

async function loadMetrics() {
  const equipmentTable = await resolveEquipmentTable();

  const jobs = [
    ['metric-heroes', countRows('heroes')],
    ['metric-equipments', equipmentTable
      ? countRows(equipmentTable)
      : Promise.resolve(null)],
    ['metric-builds', countRows('builds')],
    ['metric-users', countRows('profiles')],
    ['metric-comments', countRows('comments')],
    ['metric-blocked', countRows('profiles', { is_blocked: true })]
  ];

  await Promise.all(
    jobs.map(async ([elementId, promise]) => {
      const element = $(elementId);
      if (!element) return;

      const value = await promise;
      element.textContent = formatNumber(value);
    })
  );
}

/* ============================================================
   Listas
   ============================================================ */

function renderThumb(row) {
  const raw = pick(
    row,
    'card_image_path',
    'image_path',
    'icon_url',
    'image_url',
    'avatar_url'
  );

  if (isHttpUrl(raw)) {
    return `<img src="${escapeHtml(raw)}" alt="" loading="lazy">`;
  }

  const label = String(pick(row, 'name', 'title', 'username') ?? '?')
    .trim()
    .charAt(0)
    .toUpperCase();

  return escapeHtml(label || '?');
}

function listItem({ thumbHtml, title, badge, subtitle, actions }) {
  const badgeHtml = badge
    ? `<span class="dashboard-badge ${badge.variant ?? ''}">${escapeHtml(badge.label)}</span>`
    : '';

  const actionsHtml = (actions ?? [])
    .map(a => `<a class="admin-button" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`)
    .join('');

  return `
    <div class="dashboard-list-item">
      <div class="dashboard-list-item-main">
        <div class="dashboard-list-image">${thumbHtml}</div>

        <div class="dashboard-list-copy">
          <div class="dashboard-list-title">
            <span>${escapeHtml(title)}</span>
            ${badgeHtml}
          </div>
          <div class="dashboard-list-subtitle">${escapeHtml(subtitle ?? '')}</div>
        </div>
      </div>

      <div class="dashboard-list-actions">${actionsHtml}</div>
    </div>
  `;
}

async function loadRecentHeroes() {
  const container = $('recent-heroes');
  if (!container) return;

  const rows = await fetchRecent('heroes', 4);

  if (rows === null) {
    renderEmpty(container, 'Não foi possível carregar os heróis.');
    return;
  }

  if (!rows.length) {
    renderEmpty(container, 'Nenhum herói cadastrado ainda.');
    return;
  }

  container.innerHTML = rows.map(row => {
    const enabled = row.enabled !== false;

    return listItem({
      thumbHtml: renderThumb(row),
      title: pick(row, 'name', 'slug') ?? 'Sem nome',
      badge: {
        label: enabled ? 'Ativo' : 'Inativo',
        variant: enabled ? '' : 'inactive'
      },
      subtitle: [
        pick(row, 'slug'),
        formatDate(pick(row, 'created_at'))
      ].filter(Boolean).join(' · '),
      actions: [
        { label: 'Editar', href: `./hero-editor.html?id=${encodeURIComponent(row.id)}` },
        { label: 'Status', href: `./hero-stats.html?id=${encodeURIComponent(row.id)}` }
      ]
    });
  }).join('');
}

async function loadRecentEquipments() {
  const container = $('recent-equipments');
  if (!container) return;

  const table = await resolveEquipmentTable();

  if (!table) {
    renderEmpty(container, 'Tabela de equipamentos não encontrada.');
    return;
  }

  const rows = await fetchRecent(table, 4);

  if (rows === null) {
    renderEmpty(container, 'Não foi possível carregar os equipamentos.');
    return;
  }

  if (!rows.length) {
    renderEmpty(container, 'Nenhum equipamento cadastrado ainda.');
    return;
  }

  container.innerHTML = rows.map(row => listItem({
    thumbHtml: renderThumb(row),
    title: pick(row, 'name', 'title', 'slug') ?? 'Sem nome',
    badge: null,
    subtitle: [
      pick(row, 'rarity', 'slot', 'type'),
      formatDate(pick(row, 'created_at'))
    ].filter(Boolean).join(' · '),
    actions: [
      { label: 'Editar', href: `./equipment-editor.html?id=${encodeURIComponent(row.id)}` }
    ]
  })).join('');
}

async function loadRecentBuilds() {
  const container = $('recent-builds');
  if (!container) return;

  const rows = await fetchRecent('builds', 4);

  if (rows === null) {
    renderEmpty(container, 'Não foi possível carregar as builds.');
    return;
  }

  if (!rows.length) {
    renderEmpty(container, 'Nenhuma build criada ainda.');
    return;
  }

  container.innerHTML = rows.map(row => listItem({
    thumbHtml: renderThumb(row),
    title: pick(row, 'name', 'title') ?? 'Build sem nome',
    badge: null,
    subtitle: formatDate(pick(row, 'created_at')),
    actions: []
  })).join('');
}

async function loadRecentComments() {
  const container = $('recent-comments');
  if (!container) return;

  const rows = await fetchRecent('comments', 4);

  if (rows === null) {
    renderEmpty(container, 'Não foi possível carregar os comentários.');
    return;
  }

  if (!rows.length) {
    renderEmpty(container, 'Nenhum comentário registrado ainda.');
    return;
  }

  container.innerHTML = rows.map(row => {
    const body = String(
      pick(row, 'content', 'body', 'text', 'message') ?? ''
    );

    const preview = body.length > 70
      ? `${body.slice(0, 70)}…`
      : body || 'Sem conteúdo';

    const flagged = row.is_reported === true || row.is_hidden === true;

    return listItem({
      thumbHtml: '💬',
      title: preview,
      badge: flagged ? { label: 'Sinalizado', variant: 'warning' } : null,
      subtitle: formatDate(pick(row, 'created_at')),
      actions: []
    });
  }).join('');
}

/* ============================================================
   Inicialização
   Cada bloco falha isoladamente: um erro em comentários não
   impede as métricas ou a lista de heróis de aparecerem.
   ============================================================ */

const tasks = [
  ['métricas', loadMetrics],
  ['heróis', loadRecentHeroes],
  ['equipamentos', loadRecentEquipments],
  ['builds', loadRecentBuilds],
  ['comentários', loadRecentComments]
];

const results = await Promise.allSettled(
  tasks.map(([, fn]) => fn())
);

const failed = results
  .map((result, index) => (result.status === 'rejected' ? tasks[index][0] : null))
  .filter(Boolean);

if (failed.length) {
  console.error('[dashboard] blocos com falha:', failed);
  showMessage(
    `Alguns blocos não carregaram: ${failed.join(', ')}. Veja o Console (F12) para detalhes.`
  );
}

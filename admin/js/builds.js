import { supabase } from '../../js/supabase.js';

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = (id) => document.getElementById(id);

const list = $('builds-list');
const search = $('search');
const statusFilter = $('status-filter');
const heroFilter = $('hero-filter');
const sortFilter = $('sort-filter');
const pageSizeSelect = $('page-size');
const message = $('message');
const refreshButton = $('refresh');

const contextBar = $('context-bar');
const contextLabel = $('context-label');

const prevPage = $('prev-page');
const nextPage = $('next-page');
const paginationInfo = $('pagination-info');

/* =========================================================
   ESTADO
========================================================= */

let builds = [];
let heroes = [];
const authors = new Map();
const heroMap = new Map();

let page = 0;
let pageSize = 25;
let totalCount = 0;
let isLoading = false;
let activeActionId = null;

const params = new URLSearchParams(location.search);
const filterUserId = params.get('user');
const filterHeroParam = params.get('hero');

/* =========================================================
   UTILITÁRIOS
========================================================= */

function setMessage(text = '', type = '') {
  if (!message) return;
  message.textContent = text;
  message.className = `builds-message${type ? ` ${type}` : ''}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value, withTime = false) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const options = { day: '2-digit', month: '2-digit', year: 'numeric' };

  if (withTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  return date.toLocaleDateString('pt-BR', options);
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';

  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(number);
}

function authorName(userId) {
  if (!userId) return 'Autor desconhecido';

  const author = authors.get(userId);
  if (!author) return 'Usuário removido';

  return author.display_name || author.username || 'Usuário sem nome';
}

function isDeleted(build) {
  return Boolean(build.deleted_at);
}

function isPublic(build) {
  return build.is_public !== false;
}

/* =========================================================
   CONSULTAS
========================================================= */

function applyFilters(query) {
  const term = search?.value?.trim();

  if (term) {
    const safe = term.replaceAll('%', '').replaceAll(',', '');
    query = query.or(`title.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }

  if (filterUserId) query = query.eq('user_id', filterUserId);

  const hero = heroFilter?.value || 'all';
  if (hero !== 'all') query = query.eq('hero_id', hero);

  switch (statusFilter?.value) {
    case 'public':
      query = query.eq('is_public', true).is('deleted_at', null);
      break;
    case 'private':
      query = query.eq('is_public', false).is('deleted_at', null);
      break;
    case 'featured':
      query = query.eq('is_featured', true);
      break;
    case 'deleted':
      query = query.not('deleted_at', 'is', null);
      break;
    case 'active':
      query = query.is('deleted_at', null);
      break;
    default:
      break;
  }

  return query;
}

function applySort(query) {
  const options = { ascending: false, nullsFirst: false };

  switch (sortFilter?.value) {
    case 'oldest':
      return query.order('created_at', { ascending: true });
    case 'views':
      return query.order('views', options);
    case 'likes':
      return query.order('likes', options);
    case 'rating':
      return query.order('rating_average', options);
    default:
      return query.order('created_at', { ascending: false });
  }
}

async function fetchBuilds() {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('builds')
    .select(
      'id, user_id, hero_id, title, slug, description, is_public, is_featured, likes, views, comments_count, favorites_count, fork_count, rating_average, rating_count, created_at, published_at, deleted_at',
      { count: 'exact' }
    );

  query = applyFilters(query);
  query = applySort(query);

  const { data, count, error } = await query.range(from, to);

  if (error) throw error;

  builds = data ?? [];
  totalCount = count ?? 0;

  await loadAuthors();
}

async function loadAuthors() {
  const missing = [
    ...new Set(
      builds
        .map(build => build.user_id)
        .filter(id => id && !authors.has(id))
    )
  ];

  if (!missing.length) return;

  const { data } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', missing);

  (data ?? []).forEach(profile => authors.set(profile.id, profile));
}

async function loadHeroes() {
  const { data, error } = await supabase
    .from('heroes')
    .select('id, name')
    .order('name');

  if (error) {
    console.warn('[builds] não foi possível carregar heróis:', error.message);
    return;
  }

  heroes = data ?? [];
  heroes.forEach(hero => heroMap.set(hero.id, hero));

  if (heroFilter) {
    const options = heroes
      .map(hero => `<option value="${escapeHtml(hero.id)}">${escapeHtml(hero.name)}</option>`)
      .join('');

    heroFilter.innerHTML = `<option value="all">Todos</option>${options}`;

    if (filterHeroParam) heroFilter.value = filterHeroParam;
  }
}

async function fetchSummary() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const base = () => {
    let query = supabase.from('builds').select('id', { count: 'exact', head: true });
    if (filterUserId) query = query.eq('user_id', filterUserId);
    return query;
  };

  const [total, publicCount, featured, deleted, recent] = await Promise.all([
    base(),
    base().eq('is_public', true).is('deleted_at', null),
    base().eq('is_featured', true),
    base().not('deleted_at', 'is', null),
    base().gte('created_at', sevenDaysAgo)
  ]);

  const values = {
    'summary-total': total.count,
    'summary-public': publicCount.count,
    'summary-featured': featured.count,
    'summary-deleted': deleted.count,
    'summary-recent': recent.count
  };

  for (const [id, value] of Object.entries(values)) {
    const element = $(id);
    if (element) element.textContent = value ?? '—';
  }
}

/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function renderContextBar() {
  if (!contextBar) return;

  if (!filterUserId) {
    contextBar.classList.remove('is-visible');
    return;
  }

  contextLabel.textContent = `Mostrando apenas builds de ${authorName(filterUserId)}`;
  contextBar.classList.add('is-visible');
}

function renderBuildCard(build) {
  const deleted = isDeleted(build);
  const publicBuild = isPublic(build);
  const featured = build.is_featured === true;
  const isBusy = activeActionId === build.id;

  const hero = heroMap.get(build.hero_id);

  const badges = [
    featured ? '<span class="build-badge featured">Destaque</span>' : '',
    !publicBuild ? '<span class="build-badge private">Privada</span>' : '',
    deleted ? '<span class="build-badge deleted">Removida</span>' : ''
  ].filter(Boolean).join('');

  const classes = [
    'build-card',
    featured ? 'is-featured' : '',
    !publicBuild ? 'is-private' : '',
    deleted ? 'is-deleted' : ''
  ].filter(Boolean).join(' ');

  const rating = Number(build.rating_average);
  const ratingText = Number.isFinite(rating) && build.rating_count
    ? `${rating.toFixed(1)}`
    : '—';

  return `
    <article class="${classes}" data-build-id="${escapeHtml(build.id)}">
      <div class="build-main">
        <div class="build-title">
          <strong>${escapeHtml(build.title || 'Build sem título')}</strong>
          ${badges}
        </div>

        <div class="build-subtitle">
          ${escapeHtml(hero?.name ? `${hero.name} · ` : '')}por
          <a href="./builds.html?user=${encodeURIComponent(build.user_id ?? '')}">
            ${escapeHtml(authorName(build.user_id))}
          </a>
          · ${escapeHtml(formatDate(build.created_at))}
          ${build.slug ? ` · ${escapeHtml(build.slug)}` : ''}
          · <a href="./comments.html?build=${encodeURIComponent(build.id)}">ver comentários</a>
        </div>

        ${
          build.description
            ? `<div class="build-description">${escapeHtml(build.description)}</div>`
            : ''
        }
      </div>

      <div class="build-stats">
        <div class="build-stat">
          <span>Views</span>
          <strong>${compactNumber(build.views)}</strong>
        </div>

        <div class="build-stat">
          <span>Curtidas</span>
          <strong>${compactNumber(build.likes)}</strong>
        </div>

        <div class="build-stat">
          <span>Coment.</span>
          <strong>${compactNumber(build.comments_count)}</strong>
        </div>

        <div class="build-stat">
          <span>Nota</span>
          <strong>${escapeHtml(ratingText)}</strong>
        </div>
      </div>

      <div class="build-actions">
        <button
          class="admin-button"
          type="button"
          data-flag="is_featured"
          data-value="${featured ? 'false' : 'true'}"
          data-id="${escapeHtml(build.id)}"
          ${isBusy || deleted ? 'disabled' : ''}
        >
          ${featured ? 'Tirar destaque' : 'Destacar'}
        </button>

        <button
          class="admin-button"
          type="button"
          data-flag="is_public"
          data-value="${publicBuild ? 'false' : 'true'}"
          data-id="${escapeHtml(build.id)}"
          ${isBusy || deleted ? 'disabled' : ''}
        >
          ${publicBuild ? 'Despublicar' : 'Publicar'}
        </button>

        <button
          class="admin-button ${deleted ? '' : 'danger'}"
          type="button"
          data-flag="deleted"
          data-value="${deleted ? 'false' : 'true'}"
          data-id="${escapeHtml(build.id)}"
          ${isBusy ? 'disabled' : ''}
        >
          ${deleted ? 'Restaurar' : 'Remover'}
        </button>
      </div>
    </article>
  `;
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const first = totalCount === 0 ? 0 : page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, totalCount);

  if (paginationInfo) {
    paginationInfo.textContent = totalCount === 0
      ? 'Nenhum resultado'
      : `${first}–${last} de ${totalCount} · página ${page + 1} de ${totalPages}`;
  }

  if (prevPage) prevPage.disabled = page === 0;
  if (nextPage) nextPage.disabled = page + 1 >= totalPages;
}

function render() {
  if (!builds.length) {
    list.innerHTML = '<div class="builds-empty">Nenhuma build encontrada.</div>';
  } else {
    list.innerHTML = builds.map(renderBuildCard).join('');
  }

  renderContextBar();
  renderPagination();
}

/* =========================================================
   AÇÕES
========================================================= */

const FLAG_LABELS = {
  is_featured: { on: 'destacada', off: 'sem destaque' },
  is_public: { on: 'publicada', off: 'despublicada' },
  deleted: { on: 'removida', off: 'restaurada' }
};

async function setFlag(buildId, flag, value) {
  const build = builds.find(item => item.id === buildId);
  if (!build) return;

  if (flag === 'deleted' && value === true) {
    const confirmed = window.confirm(
      `Remover a build "${build.title || 'sem título'}"?\n\n` +
      'Ela sai do site, mas continua no banco e pode ser restaurada.'
    );

    if (!confirmed) return;
  }

  activeActionId = buildId;
  render();
  setMessage('Aplicando...');

  try {
    const { error } = await supabase.rpc('admin_set_build_flag', {
      build_id: buildId,
      flag,
      value
    });

    if (error) throw error;

    if (flag === 'deleted') {
      build.deleted_at = value ? new Date().toISOString() : null;
    } else {
      build[flag] = value;
    }

    const label = FLAG_LABELS[flag];
    setMessage(`Build ${value ? label.on : label.off}.`, 'ok');

    fetchSummary();
  } catch (error) {
    console.error('Erro ao moderar build:', error);
    setMessage(error.message || 'Não foi possível aplicar a ação.', 'error');
  } finally {
    activeActionId = null;
    render();
  }
}

list?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-flag]');
  if (!button) return;

  setFlag(
    button.dataset.id,
    button.dataset.flag,
    button.dataset.value === 'true'
  );
});

/* =========================================================
   CARREGAMENTO
========================================================= */

async function refresh(showLoading = true) {
  if (isLoading) return;
  isLoading = true;

  if (showLoading) {
    list.innerHTML = '<div class="builds-empty">Carregando builds...</div>';
    setMessage('Carregando...');
  }

  try {
    await fetchBuilds();

    if (showLoading) setMessage('');

    render();
  } catch (error) {
    console.error('Erro ao carregar builds:', error);
    list.innerHTML = '<div class="builds-empty">Não foi possível carregar as builds.</div>';
    setMessage(error.message || 'Não foi possível carregar as builds.', 'error');
  } finally {
    isLoading = false;
  }
}

async function init() {
  if (filterUserId) {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .eq('id', filterUserId)
      .maybeSingle();

    if (data) authors.set(data.id, data);
  }

  await loadHeroes();

  fetchSummary();
  await refresh();
}

/* =========================================================
   EVENTOS
========================================================= */

let searchTimer = null;

search?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page = 0;
    refresh();
  }, 300);
});

[statusFilter, heroFilter, sortFilter].forEach(element => {
  element?.addEventListener('change', () => {
    page = 0;
    refresh();
  });
});

pageSizeSelect?.addEventListener('change', () => {
  pageSize = Number(pageSizeSelect.value) || 25;
  page = 0;
  refresh();
});

prevPage?.addEventListener('click', () => {
  if (page > 0) {
    page -= 1;
    refresh();
  }
});

nextPage?.addEventListener('click', () => {
  if ((page + 1) * pageSize < totalCount) {
    page += 1;
    refresh();
  }
});

refreshButton?.addEventListener('click', () => {
  fetchSummary();
  refresh();
});

await init();

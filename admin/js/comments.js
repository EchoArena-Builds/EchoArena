import { supabase } from '../../js/supabase.js';

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = (id) => document.getElementById(id);

const list = $('comments-list');
const search = $('search');
const statusFilter = $('status-filter');
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

let comments = [];
let authors = new Map();
let builds = new Map();

let page = 0;
let pageSize = 25;
let totalCount = 0;
let isLoading = false;
let activeActionId = null;

const params = new URLSearchParams(location.search);
const filterUserId = params.get('user');
const filterBuildId = params.get('build');

/* =========================================================
   UTILITÁRIOS
========================================================= */

function setMessage(text = '', type = '') {
  if (!message) return;
  message.textContent = text;
  message.className = `comments-message${type ? ` ${type}` : ''}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value, withTime = true) {
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

function authorName(userId) {
  if (!userId) return 'Autor desconhecido';

  const author = authors.get(userId);

  /* Perfil ausente é diferente de perfil sem nome preenchido. */
  if (!author) return 'Usuário removido';

  return author.display_name || author.username || 'Usuário sem nome';
}

/* =========================================================
   CONSULTAS
========================================================= */

function applyFilters(query) {
  const term = search?.value?.trim();

  if (term) {
    const safe = term.replaceAll('%', '').replaceAll(',', '');
    query = query.ilike('message', `%${safe}%`);
  }

  if (filterUserId) query = query.eq('user_id', filterUserId);
  if (filterBuildId) query = query.eq('build_id', filterBuildId);

  switch (statusFilter?.value) {
    case 'hidden':
      query = query.eq('is_hidden', true);
      break;
    case 'deleted':
      query = query.eq('is_deleted', true);
      break;
    case 'pinned':
      query = query.eq('is_pinned', true);
      break;
    case 'visible':
      query = query
        .or('is_hidden.is.null,is_hidden.eq.false')
        .or('is_deleted.is.null,is_deleted.eq.false');
      break;
    default:
      break;
  }

  return query;
}

function applySort(query) {
  switch (sortFilter?.value) {
    case 'oldest':
      return query.order('created_at', { ascending: true });
    case 'likes':
      return query.order('likes_count', { ascending: false, nullsFirst: false });
    default:
      return query.order('created_at', { ascending: false });
  }
}

async function fetchComments() {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('comments')
    .select(
      'id, build_id, user_id, message, created_at, edited_at, parent_comment_id, is_deleted, is_hidden, is_pinned, likes_count',
      { count: 'exact' }
    );

  query = applyFilters(query);
  query = applySort(query);

  const { data, count, error } = await query.range(from, to);

  if (error) throw error;

  comments = data ?? [];
  totalCount = count ?? 0;

  await loadRelated();
}

/* Carrega autores e builds referenciados nesta página. */
async function loadRelated() {
  const userIds = [...new Set(comments.map(c => c.user_id).filter(Boolean))];
  const buildIds = [...new Set(comments.map(c => c.build_id).filter(Boolean))];

  const jobs = [];

  if (userIds.length) {
    jobs.push(
      supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', userIds)
        .then(({ data }) => {
          (data ?? []).forEach(profile => authors.set(profile.id, profile));
        })
    );
  }

  if (buildIds.length) {
    jobs.push(
      supabase
        .from('builds')
        .select('id, title, slug')
        .in('id', buildIds)
        .then(({ data }) => {
          (data ?? []).forEach(build => builds.set(build.id, build));
        })
    );
  }

  await Promise.all(jobs);
}

async function fetchSummary() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const base = () => {
    let query = supabase.from('comments').select('id', { count: 'exact', head: true });
    if (filterUserId) query = query.eq('user_id', filterUserId);
    if (filterBuildId) query = query.eq('build_id', filterBuildId);
    return query;
  };

  const [total, hidden, deleted, recent] = await Promise.all([
    base(),
    base().eq('is_hidden', true),
    base().eq('is_deleted', true),
    base().gte('created_at', sevenDaysAgo)
  ]);

  const values = {
    'summary-total': total.count,
    'summary-hidden': hidden.count,
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

  if (!filterUserId && !filterBuildId) {
    contextBar.classList.remove('is-visible');
    return;
  }

  const label = filterUserId
    ? `Mostrando apenas comentários de ${authorName(filterUserId)}`
    : `Mostrando apenas comentários da build ${builds.get(filterBuildId)?.title ?? filterBuildId}`;

  contextLabel.textContent = label;
  contextBar.classList.add('is-visible');
}

function renderCommentCard(comment) {
  const author = authors.get(comment.user_id);
  const build = builds.get(comment.build_id);

  const hidden = comment.is_hidden === true;
  const deleted = comment.is_deleted === true;
  const pinned = comment.is_pinned === true;
  const isBusy = activeActionId === comment.id;

  const avatarInner = author?.avatar_url
    ? `<img src="${escapeHtml(author.avatar_url)}" alt="" loading="lazy">`
    : escapeHtml(authorName(comment.user_id).trim().charAt(0).toUpperCase() || '?');

  const flags = [
    pinned ? '<span class="comment-badge pinned">Fixado</span>' : '',
    hidden ? '<span class="comment-badge hidden">Oculto</span>' : '',
    deleted ? '<span class="comment-badge deleted">Removido</span>' : '',
    comment.parent_comment_id ? '<span class="comment-badge">Resposta</span>' : ''
  ].filter(Boolean).join('');

  const classes = [
    'comment-card',
    hidden ? 'is-hidden' : '',
    deleted ? 'is-deleted' : '',
    pinned ? 'is-pinned' : ''
  ].filter(Boolean).join(' ');

  return `
    <article class="${classes}" data-comment-id="${escapeHtml(comment.id)}">
      <div class="comment-head">
        <div class="comment-author">
          <div class="comment-avatar">${avatarInner}</div>

          <div class="comment-author-copy">
            <strong>${escapeHtml(authorName(comment.user_id))}</strong>
            <span>${escapeHtml(author?.username ? `@${author.username}` : 'sem username')}</span>
          </div>
        </div>

        <div class="comment-flags">${flags}</div>
      </div>

      <div class="comment-body">${escapeHtml(comment.message || '(sem conteúdo)')}</div>

      <div class="comment-meta">
        <span>${escapeHtml(formatDate(comment.created_at))}</span>
        ${comment.edited_at ? `<span>editado ${escapeHtml(formatDate(comment.edited_at))}</span>` : ''}
        <span>${comment.likes_count ?? 0} curtida(s)</span>
        ${
          build
            ? `<a href="./comments.html?build=${encodeURIComponent(build.id)}">Build: ${escapeHtml(build.title || build.slug || '—')}</a>`
            : ''
        }
        ${
          comment.user_id
            ? `<a href="./comments.html?user=${encodeURIComponent(comment.user_id)}">Ver do autor</a>`
            : ''
        }
      </div>

      <div class="comment-actions">
        <button
          class="admin-button"
          type="button"
          data-flag="is_hidden"
          data-value="${hidden ? 'false' : 'true'}"
          data-id="${escapeHtml(comment.id)}"
          ${isBusy ? 'disabled' : ''}
        >
          ${hidden ? 'Reexibir' : 'Ocultar'}
        </button>

        <button
          class="admin-button"
          type="button"
          data-flag="is_pinned"
          data-value="${pinned ? 'false' : 'true'}"
          data-id="${escapeHtml(comment.id)}"
          ${isBusy ? 'disabled' : ''}
        >
          ${pinned ? 'Desafixar' : 'Fixar'}
        </button>

        <button
          class="admin-button ${deleted ? '' : 'danger'}"
          type="button"
          data-flag="is_deleted"
          data-value="${deleted ? 'false' : 'true'}"
          data-id="${escapeHtml(comment.id)}"
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
  if (!comments.length) {
    list.innerHTML = '<div class="comments-empty">Nenhum comentário encontrado.</div>';
  } else {
    list.innerHTML = comments.map(renderCommentCard).join('');
  }

  renderContextBar();
  renderPagination();
}

/* =========================================================
   AÇÕES
========================================================= */

const FLAG_LABELS = {
  is_hidden: { on: 'ocultado', off: 'reexibido' },
  is_pinned: { on: 'fixado', off: 'desafixado' },
  is_deleted: { on: 'removido', off: 'restaurado' }
};

async function setFlag(commentId, flag, value) {
  const comment = comments.find(item => item.id === commentId);
  if (!comment) return;

  if (flag === 'is_deleted' && value === true) {
    const confirmed = window.confirm(
      'Remover este comentário?\n\nEle deixa de aparecer no site, mas continua no banco e pode ser restaurado.'
    );

    if (!confirmed) return;
  }

  activeActionId = commentId;
  render();
  setMessage('Aplicando...');

  try {
    const { error } = await supabase.rpc('admin_set_comment_flag', {
      comment_id: commentId,
      flag,
      value
    });

    if (error) throw error;

    comment[flag] = value;

    const label = FLAG_LABELS[flag];
    setMessage(`Comentário ${value ? label.on : label.off}.`, 'ok');

    fetchSummary();
  } catch (error) {
    console.error('Erro ao moderar comentário:', error);
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
    list.innerHTML = '<div class="comments-empty">Carregando comentários...</div>';
    setMessage('Carregando...');
  }

  try {
    await fetchComments();

    if (showLoading) setMessage('');

    render();
  } catch (error) {
    console.error('Erro ao carregar comentários:', error);
    list.innerHTML = '<div class="comments-empty">Não foi possível carregar os comentários.</div>';
    setMessage(error.message || 'Não foi possível carregar os comentários.', 'error');
  } finally {
    isLoading = false;
  }
}

async function init() {
  /* Filtro por usuário vindo do painel de detalhes: carrega o
     nome antes para a barra de contexto ficar legível. */
  if (filterUserId) {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .eq('id', filterUserId)
      .maybeSingle();

    if (data) authors.set(data.id, data);
  }

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

statusFilter?.addEventListener('change', () => {
  page = 0;
  refresh();
});

sortFilter?.addEventListener('change', () => {
  page = 0;
  refresh();
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

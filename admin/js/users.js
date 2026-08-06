import { supabase } from '../../js/supabase.js';

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = (id) => document.getElementById(id);

const list = $('users-list');
const search = $('search');
const roleFilter = $('role-filter');
const statusFilter = $('status-filter');
const pageSizeSelect = $('page-size');
const message = $('message');
const refreshButton = $('refresh');

const selectAll = $('select-all');
const bulkBar = $('bulk-bar');
const bulkCount = $('bulk-count');
const bulkRole = $('bulk-role');
const bulkRoleApply = $('bulk-role-apply');
const bulkBlock = $('bulk-block');
const bulkUnblock = $('bulk-unblock');
const bulkClear = $('bulk-clear');

const prevPage = $('prev-page');
const nextPage = $('next-page');
const paginationInfo = $('pagination-info');

const drawer = $('user-drawer');
const drawerBackdrop = $('drawer-backdrop');
const drawerClose = $('drawer-close');
const drawerTitle = $('drawer-title');
const drawerSubtitle = $('drawer-subtitle');
const drawerBody = $('drawer-body');

/* =========================================================
   ESTADO
========================================================= */

let users = [];
let roles = [];
let currentUserId = null;
let activeActionId = null;
let isLoading = false;

let page = 0;
let pageSize = 25;
let totalCount = 0;

const selected = new Set();

/* Colunas de vínculo variam entre tabelas; a primeira que
   responder é usada nas contagens do painel de detalhes. */
const OWNER_COLUMNS = ['user_id', 'author_id', 'profile_id', 'created_by'];
const ownerColumnCache = {};

/* =========================================================
   UTILITÁRIOS
========================================================= */

function setMessage(text = '', type = '') {
  if (!message) return;
  message.textContent = text;
  message.className = `users-message${type ? ` ${type}` : ''}`;
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

function displayNameOf(user) {
  return user?.display_name || user?.username || 'Usuário sem nome';
}

function initialOf(user) {
  return String(displayNameOf(user)).trim().charAt(0).toUpperCase() || '?';
}

/* =========================================================
   CONSULTAS
========================================================= */

function applyFilters(query) {
  const term = search?.value?.trim();

  if (term) {
    const safe = term.replaceAll('%', '').replaceAll(',', '');
    query = query.or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`);
  }

  const role = roleFilter?.value || 'all';
  if (role !== 'all') {
    query = query.eq('role', role);
  }

  const status = statusFilter?.value || 'all';
  if (status === 'blocked') {
    query = query.eq('is_blocked', true);
  } else if (status === 'active') {
    query = query.or('is_blocked.is.null,is_blocked.eq.false');
  }

  return query;
}

async function fetchUsers() {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('profiles')
    .select(
      'id, username, display_name, avatar_url, role, is_blocked, blocked_reason, blocked_at, created_at, updated_at',
      { count: 'exact' }
    );

  query = applyFilters(query);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;

  users = data ?? [];
  totalCount = count ?? 0;
}

async function fetchSummary() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [total, admins, blocked, recent] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_blocked', true),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo)
  ]);

  const values = {
    'summary-total': total.count,
    'summary-admins': admins.count,
    'summary-blocked': blocked.count,
    'summary-recent': recent.count
  };

  for (const [id, value] of Object.entries(values)) {
    const element = $(id);
    if (element) element.textContent = value ?? '—';
  }
}

/* Descobre qual coluna liga a tabela ao usuário. */
async function resolveOwnerColumn(table) {
  if (ownerColumnCache[table] !== undefined) return ownerColumnCache[table];

  for (const column of OWNER_COLUMNS) {
    const { error } = await supabase
      .from(table)
      .select(column, { count: 'exact', head: true })
      .limit(1);

    if (!error) {
      ownerColumnCache[table] = column;
      return column;
    }
  }

  ownerColumnCache[table] = null;
  return null;
}

async function countByOwner(table, userId) {
  const column = await resolveOwnerColumn(table);
  if (!column) return null;

  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, userId);

  if (error) return null;
  return count ?? 0;
}

async function fetchModerationLog(userId) {
  const { data, error } = await supabase
    .from('user_moderation_log')
    .select('id, action, details, created_at, actor_id')
    .eq('target_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn('[users] log indisponível:', error.message);
    return null;
  }

  return data ?? [];
}

/* =========================================================
   RENDERIZAÇÃO — LISTA
========================================================= */

function renderRoleOptions() {
  const options = roles
    .map(role => `<option value="${escapeHtml(role.name)}">${escapeHtml(role.name)}</option>`)
    .join('');

  if (roleFilter) {
    const current = roleFilter.value;
    roleFilter.innerHTML = `<option value="all">Todos</option>${options}`;
    roleFilter.value = current || 'all';
  }

  if (bulkRole) {
    bulkRole.innerHTML = `<option value="">Alterar papel para...</option>${options}`;
  }
}

function renderRoleSelect(user) {
  const isSelf = user.id === currentUserId;
  const isBusy = activeActionId === user.id;

  const options = roles
    .map(role => `
      <option
        value="${escapeHtml(role.name)}"
        ${user.role === role.name ? 'selected' : ''}
      >
        ${escapeHtml(role.name)}
      </option>
    `)
    .join('');

  return `
    <select
      class="admin-select"
      data-role-for="${escapeHtml(user.id)}"
      ${isSelf || isBusy ? 'disabled' : ''}
      title="${isSelf ? 'Você não pode alterar o próprio papel' : 'Alterar papel'}"
    >
      ${options}
    </select>
  `;
}

function renderUserRow(user) {
  const blocked = user.is_blocked === true;
  const isSelf = user.id === currentUserId;
  const isBusy = activeActionId === user.id;
  const isSelected = selected.has(user.id);

  const avatarInner = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="" loading="lazy">`
    : escapeHtml(initialOf(user));

  const statusBadge = blocked
    ? '<span class="user-badge blocked">Bloqueado</span>'
    : '<span class="user-badge ok">Ativo</span>';

  const roleBadge = user.role === 'admin'
    ? ' <span class="user-badge admin">Admin</span>'
    : '';

  const blockedInfo = blocked
    ? `<small>${escapeHtml(user.blocked_reason || 'Sem motivo registrado')}${
        user.blocked_at ? ` · ${formatDate(user.blocked_at)}` : ''
      }</small>`
    : '';

  return `
    <article
      class="user-row ${blocked ? 'is-blocked' : ''} ${isSelected ? 'is-selected' : ''}"
      data-user-id="${escapeHtml(user.id)}"
    >
      <input
        class="user-select"
        type="checkbox"
        data-select="${escapeHtml(user.id)}"
        ${isSelected ? 'checked' : ''}
        ${isSelf ? 'disabled title="Sua própria conta"' : ''}
      >

      <div
        class="user-identity"
        data-open="${escapeHtml(user.id)}"
        title="Ver detalhes"
      >
        <div class="user-avatar">${avatarInner}</div>

        <div class="user-identity-copy">
          <strong>${escapeHtml(displayNameOf(user))}${roleBadge}</strong>

          <span>
            ${escapeHtml(user.username ? `@${user.username}` : 'sem username')}
            ${user.created_at ? ` · desde ${formatDate(user.created_at)}` : ''}
          </span>
        </div>
      </div>

      <div class="user-role-cell">
        ${renderRoleSelect(user)}
      </div>

      <div class="user-status-copy">
        ${statusBadge}
        ${blockedInfo}
      </div>

      <div class="user-actions">
        ${
          isSelf
            ? '<span class="user-badge">Você</span>'
            : `
              <button
                class="admin-button ${blocked ? '' : 'danger'}"
                type="button"
                data-block="${escapeHtml(user.id)}"
                ${isBusy ? 'disabled' : ''}
              >
                ${isBusy ? 'Aguarde...' : blocked ? 'Desbloquear' : 'Bloquear'}
              </button>
            `
        }
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

function renderBulkBar() {
  const count = selected.size;

  bulkBar?.classList.toggle('is-visible', count > 0);

  if (bulkCount) {
    bulkCount.textContent = count === 1
      ? '1 usuário selecionado'
      : `${count} usuários selecionados`;
  }

  if (selectAll) {
    const selectable = users.filter(u => u.id !== currentUserId);
    const allChecked =
      selectable.length > 0 &&
      selectable.every(u => selected.has(u.id));

    selectAll.checked = allChecked;
    selectAll.indeterminate = count > 0 && !allChecked;
  }
}

function render() {
  if (!users.length) {
    list.innerHTML = '<div class="users-empty">Nenhum usuário encontrado.</div>';
  } else {
    list.innerHTML = users.map(renderUserRow).join('');
    bindRowEvents();
  }

  renderPagination();
  renderBulkBar();
}

/* =========================================================
   PAINEL DE DETALHES
========================================================= */

function openDrawer() {
  drawer?.classList.add('is-open');
  drawerBackdrop?.classList.add('is-open');
  drawer?.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  drawer?.classList.remove('is-open');
  drawerBackdrop?.classList.remove('is-open');
  drawer?.setAttribute('aria-hidden', 'true');
}

function describeLogEntry(entry) {
  const details = entry.details ?? {};

  if (entry.action === 'role_change') {
    return `Papel alterado de "${details.de ?? '—'}" para "${details.para ?? '—'}"`;
  }

  if (entry.action === 'block') {
    return `Bloqueado — ${details.motivo || 'sem motivo registrado'}`;
  }

  if (entry.action === 'unblock') {
    return 'Desbloqueado';
  }

  return entry.action;
}

async function showUserDetails(userId) {
  const user = users.find(item => item.id === userId);
  if (!user) return;

  if (!drawer || !drawerBody || !drawerTitle) {
    console.error('[users] painel de detalhes não encontrado no HTML.');
    setMessage('Painel de detalhes indisponível nesta página.', 'error');
    return;
  }

  drawerTitle.textContent = displayNameOf(user);
  if (drawerSubtitle) {
    drawerSubtitle.textContent = user.username ? `@${user.username}` : 'sem username';
  }
  drawerBody.innerHTML = '<div class="users-empty">Carregando...</div>';

  openDrawer();

  const [builds, comments, ratings, log] = await Promise.all([
    countByOwner('builds', userId),
    countByOwner('comments', userId),
    countByOwner('build_ratings', userId),
    fetchModerationLog(userId)
  ]);

  const fmt = (value) => (value === null ? '—' : String(value));

  const logHtml = log === null
    ? '<div class="users-empty">Log indisponível.</div>'
    : log.length === 0
      ? '<div class="users-empty">Nenhuma ação registrada.</div>'
      : log.map(entry => `
          <div class="user-drawer-log-item ${escapeHtml(entry.action)}">
            <strong>${escapeHtml(describeLogEntry(entry))}</strong>
            <span>${escapeHtml(formatDate(entry.created_at, true))}</span>
          </div>
        `).join('');

  drawerBody.innerHTML = `
    <div class="user-drawer-stats">
      <div class="user-drawer-stat">
        <span>Builds</span>
        <strong>${fmt(builds)}</strong>
      </div>

      <div class="user-drawer-stat">
        <span>Comentários</span>
        <strong>${fmt(comments)}</strong>
      </div>

      <div class="user-drawer-stat">
        <span>Avaliações</span>
        <strong>${fmt(ratings)}</strong>
      </div>
    </div>

    <div class="user-drawer-section">
      <h3>Perfil</h3>

      <div class="user-drawer-fields">
        <div class="user-drawer-field">
          <span>Papel</span>
          <strong>${escapeHtml(user.role ?? '—')}</strong>
        </div>

        <div class="user-drawer-field">
          <span>Situação</span>
          <strong>${user.is_blocked ? 'Bloqueado' : 'Ativo'}</strong>
        </div>

        ${
          user.is_blocked
            ? `
              <div class="user-drawer-field">
                <span>Motivo</span>
                <strong>${escapeHtml(user.blocked_reason || '—')}</strong>
              </div>

              <div class="user-drawer-field">
                <span>Bloqueado em</span>
                <strong>${escapeHtml(formatDate(user.blocked_at, true) || '—')}</strong>
              </div>
            `
            : ''
        }

        <div class="user-drawer-field">
          <span>Cadastro</span>
          <strong>${escapeHtml(formatDate(user.created_at, true) || '—')}</strong>
        </div>

        <div class="user-drawer-field">
          <span>Atualizado</span>
          <strong>${escapeHtml(formatDate(user.updated_at, true) || '—')}</strong>
        </div>

        <div class="user-drawer-field">
          <span>ID</span>
          <strong>${escapeHtml(user.id)}</strong>
        </div>
      </div>
    </div>

    <div class="user-drawer-section">
      <h3>Histórico de moderação</h3>
      <div class="user-drawer-log">${logHtml}</div>
    </div>
  `;
}

/* =========================================================
   AÇÕES
========================================================= */

async function changeRole(userId, newRole) {
  const user = users.find(item => item.id === userId);
  if (!user || user.role === newRole) return;

  activeActionId = userId;
  render();
  setMessage(`Alterando papel de ${displayNameOf(user)}...`);

  try {
    const { error } = await supabase.rpc('admin_set_user_role', {
      target_id: userId,
      new_role: newRole
    });

    if (error) throw error;

    user.role = newRole;
    setMessage(`${displayNameOf(user)} agora é "${newRole}".`, 'ok');
    fetchSummary();
  } catch (error) {
    console.error('Erro ao alterar papel:', error);
    setMessage(error.message || 'Não foi possível alterar o papel.', 'error');
  } finally {
    activeActionId = null;
    render();
  }
}

async function setBlocked(userId, blocking, reason = null) {
  const { error } = await supabase.rpc('admin_set_user_blocked', {
    target_id: userId,
    blocked: blocking,
    reason: reason?.trim() || null
  });

  if (error) throw error;

  const user = users.find(item => item.id === userId);

  if (user) {
    user.is_blocked = blocking;
    user.blocked_reason = blocking ? (reason?.trim() || null) : null;
    user.blocked_at = blocking ? new Date().toISOString() : null;
  }
}

async function toggleBlock(userId) {
  const user = users.find(item => item.id === userId);
  if (!user) return;

  const blocking = user.is_blocked !== true;
  let reason = null;

  if (blocking) {
    reason = window.prompt(
      `Bloquear "${displayNameOf(user)}".\n\nMotivo (opcional):`,
      ''
    );

    if (reason === null) return;
  } else if (!window.confirm(`Desbloquear "${displayNameOf(user)}"?`)) {
    return;
  }

  activeActionId = userId;
  render();
  setMessage(blocking ? 'Bloqueando...' : 'Desbloqueando...');

  try {
    await setBlocked(userId, blocking, reason);

    setMessage(
      blocking
        ? `${displayNameOf(user)} foi bloqueado.`
        : `${displayNameOf(user)} foi desbloqueado.`,
      'ok'
    );

    fetchSummary();
  } catch (error) {
    console.error('Erro ao alterar bloqueio:', error);
    setMessage(error.message || 'Não foi possível alterar o bloqueio.', 'error');
  } finally {
    activeActionId = null;
    render();
  }
}

/* ---- ações em massa ---- */

async function runBulk(label, handler) {
  const ids = [...selected].filter(id => id !== currentUserId);
  if (!ids.length) return;

  setMessage(`${label} ${ids.length} usuário(s)...`);

  let done = 0;
  const failures = [];

  for (const id of ids) {
    try {
      await handler(id);
      done += 1;
    } catch (error) {
      console.error(`[users] falha em ${id}:`, error);
      failures.push(error.message || 'erro desconhecido');
    }
  }

  selected.clear();
  await refresh(false);

  if (failures.length) {
    setMessage(
      `${done} concluído(s), ${failures.length} com falha: ${failures[0]}`,
      'error'
    );
  } else {
    setMessage(`${done} usuário(s) atualizado(s).`, 'ok');
  }
}

/* =========================================================
   EVENTOS DE LINHA
========================================================= */

function bindRowEvents() {
  /* Delegação: os listeners ficam no container, que nunca é
     recriado. Linhas podem ser redesenhadas à vontade. */
}

list?.addEventListener('click', (event) => {
  const blockButton = event.target.closest('[data-block]');
  if (blockButton) {
    toggleBlock(blockButton.dataset.block);
    return;
  }

  const opener = event.target.closest('[data-open]');
  if (opener) {
    showUserDetails(opener.dataset.open);
  }
});

list?.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-select]');

  if (checkbox) {
    const id = checkbox.dataset.select;

    if (checkbox.checked) {
      selected.add(id);
    } else {
      selected.delete(id);
    }

    checkbox.closest('.user-row')?.classList.toggle('is-selected', checkbox.checked);
    renderBulkBar();
    return;
  }

  const roleSelect = event.target.closest('[data-role-for]');
  if (roleSelect) {
    changeRole(roleSelect.dataset.roleFor, roleSelect.value);
  }
});

/* =========================================================
   CARREGAMENTO
========================================================= */

async function refresh(showLoading = true) {
  if (isLoading) return;
  isLoading = true;

  if (showLoading) {
    list.innerHTML = '<div class="users-empty">Carregando usuários...</div>';
    setMessage('Carregando...');
  }

  try {
    await fetchUsers();

    if (showLoading) setMessage('');

    render();
  } catch (error) {
    console.error('Erro ao carregar usuários:', error);
    list.innerHTML = '<div class="users-empty">Não foi possível carregar os usuários.</div>';
    setMessage(error.message || 'Não foi possível carregar os usuários.', 'error');
  } finally {
    isLoading = false;
  }
}

async function init() {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    currentUserId = sessionData?.session?.user?.id ?? null;

    const { data: rolesData, error: rolesError } = await supabase
      .from('roles')
      .select('id, name')
      .order('id');

    if (rolesError) throw rolesError;

    roles = rolesData ?? [];
    renderRoleOptions();
  } catch (error) {
    console.error('Erro ao carregar papéis:', error);
    setMessage('Não foi possível carregar a lista de papéis.', 'error');
  }

  fetchSummary();
  await refresh();
}

/* =========================================================
   EVENTOS GLOBAIS
========================================================= */

let searchTimer = null;

search?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page = 0;
    selected.clear();
    refresh();
  }, 300);
});

roleFilter?.addEventListener('change', () => {
  page = 0;
  selected.clear();
  refresh();
});

statusFilter?.addEventListener('change', () => {
  page = 0;
  selected.clear();
  refresh();
});

pageSizeSelect?.addEventListener('change', () => {
  pageSize = Number(pageSizeSelect.value) || 25;
  page = 0;
  selected.clear();
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

selectAll?.addEventListener('change', () => {
  const selectable = users.filter(u => u.id !== currentUserId);

  if (selectAll.checked) {
    selectable.forEach(u => selected.add(u.id));
  } else {
    selectable.forEach(u => selected.delete(u.id));
  }

  render();
});

bulkClear?.addEventListener('click', () => {
  selected.clear();
  render();
});

bulkBlock?.addEventListener('click', async () => {
  const reason = window.prompt(
    `Bloquear ${selected.size} usuário(s).\n\nMotivo (opcional):`,
    ''
  );

  if (reason === null) return;

  await runBulk('Bloqueando', id => setBlocked(id, true, reason));
  fetchSummary();
});

bulkUnblock?.addEventListener('click', async () => {
  if (!window.confirm(`Desbloquear ${selected.size} usuário(s)?`)) return;

  await runBulk('Desbloqueando', id => setBlocked(id, false));
  fetchSummary();
});

bulkRoleApply?.addEventListener('click', async () => {
  const newRole = bulkRole?.value;

  if (!newRole) {
    setMessage('Escolha um papel antes de aplicar.', 'error');
    return;
  }

  if (!window.confirm(`Definir papel "${newRole}" para ${selected.size} usuário(s)?`)) {
    return;
  }

  await runBulk('Alterando papel de', async (id) => {
    const { error } = await supabase.rpc('admin_set_user_role', {
      target_id: id,
      new_role: newRole
    });

    if (error) throw error;
  });

  fetchSummary();
});

drawerClose?.addEventListener('click', closeDrawer);
drawerBackdrop?.addEventListener('click', closeDrawer);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
});

await init();

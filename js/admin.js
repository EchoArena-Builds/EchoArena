// ============================================================
// ECHO ARENA — ADMIN
// Usa o mesmo cliente do site. Se o seu ./supabase.js exportar
// com outro nome (ex: default), ajuste APENAS esta linha.
// ============================================================
import { supabase } from './supabase.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// raridades carregadas do banco (tabela equipment_tiers = catálogo de raridades)
let TIERS = [];
const SLOTS = ['cabeca','peito','ombro','pes','acessorio','utilitario'];

async function loadTierCatalog() {
  const { data } = await supabase.from('equipment_tiers')
    .select('name, slug, display_order, color, enabled')
    .order('display_order');
  TIERS = (data || []).filter(t => t.enabled !== false);
  if (!TIERS.length) TIERS = ['comum','raro','epico','lendario','mitico','supremo',
    'grandioso','celestial','estelar','imortal','divino']
    .map((s, i) => ({ name: s, slug: s, display_order: i + 1, color: '#A79CC8' }));
}

let ME = null;

/* ---------------- utils ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const fmtDate = d => new Date(d).toLocaleString('pt-BR',
  { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });

function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.className = 'toast', 2600);
}

async function confirmAction(text) {
  return new Promise(res => {
    const m = $('#confirm');
    $('#confirmText').textContent = text;
    m.classList.add('open');
    const done = v => { m.classList.remove('open'); res(v); };
    $('#confirmYes').onclick = () => done(true);
    $('#confirmNo').onclick  = () => done(false);
  });
}

async function log(action, target, detail = {}) {
  try { await supabase.rpc('log_admin', { p_action: action, p_target: String(target), p_detail: detail }); }
  catch (_) { /* log é best-effort */ }
}

/* ---------------- auth / guarda ---------------- */
async function boot() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return lock('Faça login para acessar o painel.');

  const { data: prof, error } = await supabase
    .from('profiles').select('id, username, display_name, role').eq('id', user.id).single();

  if (error || prof?.role !== 'admin') return lock('Sua conta não tem permissão de administrador.');

  ME = { ...prof, email: user.email };
  $('#whoami').textContent = prof.display_name || prof.username || user.email;
  $('#gate').style.display = 'none';
  $('#app').style.display  = '';

  bindNav();
  await loadTierCatalog();
  loadDashboard();
}

function lock(msg) {
  $('#gateMsg').textContent = msg;
  $('#gate').style.display = '';
  $('#app').style.display  = 'none';
}

$('#logout')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

/* ---------------- navegação ---------------- */
const VIEWS = {
  dashboard:   loadDashboard,
  comentarios: loadComments,
  builds:      loadBuilds,
  equipamentos:loadEquipment,
  usuarios:    loadUsers,
  textos:      loadTexts,
  logs:        loadLogs,
};

function bindNav() {
  $$('.anav a').forEach(a => a.onclick = e => {
    e.preventDefault();
    const v = a.dataset.view;
    $$('.anav a').forEach(x => x.classList.toggle('on', x === a));
    $$('.view').forEach(s => s.classList.toggle('on', s.id === 'view-' + v));
    VIEWS[v]?.();
  });
}

/* ---------------- 1. DASHBOARD ---------------- */
async function loadDashboard() {
  const box = $('#kpis');
  box.innerHTML = '<div class="skel"></div>'.repeat(5);

  const count = async (table, filter) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c ?? 0;
  };

  const [users, blocked, admins, builds, comments, hidden, recheck] = await Promise.all([
    count('profiles'),
    count('profiles', q => q.eq('is_blocked', true)),
    count('profiles', q => q.eq('role', 'admin')),
    count('builds'),
    count('comments'),
    count('comments', q => q.eq('is_hidden', true)),
    count('equipment_tier_stats', q => q.eq('needs_recheck', true)),
  ]);

  box.innerHTML = [
    ['Usuários', users, ''],
    ['Admins', admins, ''],
    ['Bloqueados', blocked, blocked ? 'bad' : ''],
    ['Builds', builds, ''],
    ['Comentários', comments, ''],
    ['Ocultos', hidden, hidden ? 'warn' : ''],
    ['Reverificar', recheck, recheck ? 'warn' : ''],
  ].map(([l, v, k]) => `
    <div class="kpi ${k}"><div class="l">${l}</div><div class="v">${v.toLocaleString('pt-BR')}</div></div>
  `).join('');
}

/* ---------------- 2. COMENTÁRIOS ---------------- */
async function loadComments() {
  const wrap = $('#commentsList');
  wrap.innerHTML = '<div class="skel tall"></div>';
  const filter = $('#commentFilter').value;

  let q = supabase.from('v_admin_comments').select('*').limit(200);
  if (filter === 'pinned') q = q.eq('is_pinned', true);
  if (filter === 'hidden') q = q.eq('is_hidden', true);

  const { data, error } = await q;
  if (error) return wrap.innerHTML = err(error);
  if (!data?.length) return wrap.innerHTML = empty('Nenhum comentário.');

  wrap.innerHTML = data.map(c => `
    <div class="row ${c.is_pinned ? 'pinned' : ''} ${c.is_hidden ? 'hidden-row' : ''}" data-id="${c.id}">
      <div class="row-main">
        <div class="row-top">
          <b>${esc(c.display_name || c.username || 'anônimo')}</b>
          ${c.is_blocked ? '<span class="chip bad">bloqueado</span>' : ''}
          ${c.is_pinned  ? '<span class="chip gold">destacado</span>' : ''}
          ${c.is_hidden  ? '<span class="chip warn">oculto</span>' : ''}
          ${c.is_deleted ? '<span class="chip bad">excluído</span>' : ''}
          <span class="muted">${fmtDate(c.created_at)}</span>
          ${c.build_name ? `<span class="muted">· ${esc(c.build_name)}</span>` : ''}
        </div>
        <p class="row-body">${esc(c.body)}</p>
      </div>
      <div class="row-acts">
        <button class="b" data-act="pin">${c.is_pinned ? 'Remover destaque' : 'Destacar'}</button>
        <button class="b" data-act="hide">${c.is_hidden ? 'Reexibir' : 'Ocultar'}</button>
        <button class="b danger" data-act="del">Apagar</button>
      </div>
    </div>`).join('');

  wrap.onclick = async e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const row = btn.closest('.row'), id = row.dataset.id;
    const act = btn.dataset.act;

    if (act === 'del') {
      if (!await confirmAction('Apagar este comentário permanentemente?')) return;
      const { error } = await supabase.from('comments').delete().eq('id', id);
      if (error) return toast(error.message, 'bad');
      await log('comment.delete', id);
      row.remove(); toast('Comentário apagado.');
      return;
    }    const field = act === 'pin' ? 'is_pinned' : 'is_hidden';
    const now   = row.classList.contains(act === 'pin' ? 'pinned' : 'hidden-row');
    const { error } = await supabase.from('comments').update({ [field]: !now }).eq('id', id);
    if (error) return toast(error.message, 'bad');
    await log('comment.' + act, id, { value: !now });
    toast(act === 'pin' ? (now ? 'Destaque removido.' : 'Comentário destacado.')
                        : (now ? 'Comentário reexibido.' : 'Comentário ocultado.'));
    loadComments();
  };
}
$('#commentFilter')?.addEventListener('change', loadComments);

/* ---------------- 3. BUILDS ---------------- */
async function loadBuilds() {
  const wrap = $('#buildsList');
  wrap.innerHTML = '<div class="skel tall"></div>';
  const term = $('#buildSearch').value.trim();

  let q = supabase.from('builds').select('*').order('created_at', { ascending: false }).limit(200);
  if (term) q = q.ilike('title', `%${term}%`);

  const { data, error } = await q;
  if (error) return wrap.innerHTML = err(error);
  if (!data?.length) return wrap.innerHTML = empty('Nenhuma build.');

  wrap.innerHTML = data.map(b => `
    <div class="row" data-id="${b.id}">
      <div class="row-main">
        <div class="row-top"><b>${esc(b.title || 'sem título')}</b>
          ${b.is_featured ? '<span class="chip gold">destacada</span>' : ''}
          ${b.is_public === false ? '<span class="chip">privada</span>' : ''}
          <span class="muted">${b.created_at ? fmtDate(b.created_at) : ''}</span>
        </div>
        <p class="row-body muted">${esc((b.description || '').slice(0, 160))}</p>
      </div>
      <div class="row-acts">
        <button class="b" data-act="feature">${b.is_featured ? 'Remover destaque' : 'Destacar'}</button>
        <button class="b" data-act="pub">${b.is_public === false ? 'Tornar pública' : 'Tornar privada'}</button>
        <button class="b danger" data-act="del">Apagar</button>
      </div>
    </div>`).join('');

  wrap.onclick = async e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const row = btn.closest('.row'), id = row.dataset.id;

    if (btn.dataset.act === 'del') {
      if (!await confirmAction('Apagar esta build? Os comentários dela também serão removidos.')) return;
      const { error } = await supabase.from('builds').delete().eq('id', id);
      if (error) return toast(error.message, 'bad');
      await log('build.delete', id); row.remove(); toast('Build apagada.');
    } else if (btn.dataset.act === 'pub') {
      const isPrivate = btn.textContent.includes('pública');
      const { error } = await supabase.from('builds').update({ is_public: isPrivate }).eq('id', id);
      if (error) return toast(error.message, 'bad');
      await log('build.visibility', id, { is_public: isPrivate }); loadBuilds();
    } else {
      const on = row.querySelector('.chip.gold');
      const { error } = await supabase.from('builds').update({ is_featured: !on }).eq('id', id);
      if (error) return toast('Sua tabela builds precisa da coluna is_featured (boolean).', 'bad');
      await log('build.feature', id, { value: !on }); loadBuilds();
    }
  };
}
$('#buildSearch')?.addEventListener('input', debounce(loadBuilds, 350));

/* ---------------- 4. EQUIPAMENTOS ---------------- */
async function loadEquipment() {
  const list = $('#eqList');
  list.innerHTML = '<div class="skel tall"></div>';
  const term = $('#eqSearch').value.trim();

  let q = supabase.from('equipment').select('*').order('slot').order('name').limit(300);
  if (term) q = q.ilike('name', `%${term}%`);

  const { data, error } = await q;
  if (error) return list.innerHTML = err(error);
  if (!data?.length) return list.innerHTML = empty('Nenhum equipamento cadastrado. Use “+ Novo equipamento”.');

  list.innerHTML = data.map(e => `
    <button class="eq-item" data-id="${e.id}">
      <span class="eq-name">${esc(e.name)}</span>
      <span class="muted">${esc(e.slot)} · ${esc(e.set_name || e.set_type)}</span>
    </button>`).join('');

  list.onclick = ev => {
    const it = ev.target.closest('.eq-item'); if (!it) return;
    $$('.eq-item').forEach(x => x.classList.toggle('on', x === it));
    openEquipment(it.dataset.id);
  };
}
$('#eqSearch')?.addEventListener('input', debounce(loadEquipment, 350));

async function openEquipment(id) {
  const pane = $('#eqEditor');
  pane.innerHTML = '<div class="skel tall"></div>';

  const [{ data: eq }, { data: stats }] = await Promise.all([
    supabase.from('equipment').select('*').eq('id', id).single(),
    supabase.from('equipment_tier_stats').select('*').eq('equipment_id', id),
  ]);
  if (!eq) return pane.innerHTML = empty('Equipamento não encontrado.');

  const byTier = Object.fromEntries((stats || []).map(t => [t.tier_slug, t]));

  pane.innerHTML = `
    <div class="pane-head">
      <div>
        <input class="title-input" id="eqName" value="${esc(eq.name || '')}">
        <div class="inline">
          <select id="eqSlot">${SLOTS.map(s => `<option ${s === eq.slot ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <select id="eqSetType">${['geral','especial','avulso'].map(s =>
            `<option ${s === eq.set_type ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <input id="eqSetName" placeholder="Nome do conjunto" value="${esc(eq.set_name || '')}">
        </div>
      </div>
      <div class="pane-acts">
        <button class="b" id="eqSave">Salvar</button>
        <button class="b danger" id="eqDel">Apagar</button>
      </div>
    </div>

    <div class="tier-table">
      <div class="tier-head"><span>Raridade</span><span>Efeito (texto exibido)</span><span>Efeitos (JSON)</span><span>Versão</span><span></span></div>
      ${TIERS.map(t => {
        const d = byTier[t.slug] || {};
        return `<div class="tier-row ${d.needs_recheck ? 'recheck' : ''}" data-tier="${esc(t.slug)}">
          <span class="tier-name" style="color:${esc(t.color || '#A79CC8')}">${esc(t.name)}</span>
          <input class="ti-text" value="${esc(d.effect_text || '')}" placeholder="+30 visão · +3% dano à armadura">
          <input class="ti-json" value='${esc(JSON.stringify(d.effects || {}))}' placeholder='{"armorDmgPct":0.03}'>
          <input class="ti-ver" value="${esc(d.verified_version || '')}" placeholder="abr/2026">
          <label class="ti-chk"><input type="checkbox" class="ti-recheck" ${d.needs_recheck ? 'checked' : ''}> rever</label>
        </div>`;
      }).join('')}
    </div>
    <div class="pane-foot"><button class="b primary" id="tierSave">Salvar raridades</button>
      <span class="muted">Deixe em branco as raridades que ainda não foram coletadas.</span></div>`;

  $('#eqSave').onclick = async () => {
    const patch = {
      name: $('#eqName').value.trim(),
      slot: $('#eqSlot').value,
      set_type: $('#eqSetType').value,
      set_name: $('#eqSetName').value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('equipment').update(patch).eq('id', id);
    if (error) return toast(error.message, 'bad');
    await log('equipment.update', id, patch); toast('Equipamento salvo.'); loadEquipment();
  };

  $('#eqDel').onclick = async () => {
    if (!await confirmAction(`Apagar "${eq.name}" e todas as raridades dele?`)) return;
    const { error } = await supabase.from('equipment').delete().eq('id', id);
    if (error) return toast(error.message, 'bad');
    await log('equipment.delete', id); toast('Equipamento apagado.');
    pane.innerHTML = empty('Selecione um equipamento.'); loadEquipment();
  };

  $('#tierSave').onclick = async () => {
    const rows = $$('.tier-row', pane);
    const up = [], del = [];
    for (const r of rows) {
      const tier_slug = r.dataset.tier;
      const text  = $('.ti-text', r).value.trim();
      const jsonS = $('.ti-json', r).value.trim();
      const ver   = $('.ti-ver', r).value.trim();
      const rech  = $('.ti-recheck', r).checked;

      if (!text && (!jsonS || jsonS === '{}')) { del.push(tier_slug); continue; }
      let effects = {};
      try { effects = jsonS ? JSON.parse(jsonS) : {}; }
      catch { return toast(`JSON inválido na raridade "${tier_slug}".`, 'bad'); }

      up.push({ equipment_id: id, tier_slug, effects, effect_text: text || null,
                verified_version: ver || null, needs_recheck: rech,
                updated_at: new Date().toISOString() });
    }
    if (up.length) {
      const { error } = await supabase.from('equipment_tier_stats')
        .upsert(up, { onConflict: 'equipment_id,tier_slug' });
      if (error) return toast(error.message, 'bad');
    }
    if (del.length) {
      await supabase.from('equipment_tier_stats')
        .delete().eq('equipment_id', id).in('tier_slug', del);
    }
    await log('equipment.tiers', id, { saved: up.length, removed: del.length });
    toast(`Raridades salvas (${up.length}).`);
  };
}

$('#eqNew')?.addEventListener('click', async () => {
  const name = prompt('Nome do novo equipamento:');
  if (!name) return;
  const { data, error } = await supabase.from('equipment')
    .insert({ name: name.trim(), slot: 'cabeca', set_type: 'avulso' }).select().single();
  if (error) return toast(error.message, 'bad');
  await log('equipment.create', data.id, { name });
  toast('Equipamento criado.'); await loadEquipment(); openEquipment(data.id);
});

/* ---------------- 5. USUÁRIOS ---------------- */
async function loadUsers() {
  const wrap = $('#usersList');
  wrap.innerHTML = '<div class="skel tall"></div>';
  const term = $('#userSearch').value.trim();

  let q = supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(200);
  if (term) q = q.ilike('username', `%${term}%`);

  const { data, error } = await q;
  if (error) return wrap.innerHTML = err(error);
  if (!data?.length) return wrap.innerHTML = empty('Nenhum usuário.');

  wrap.innerHTML = data.map(u => `
    <div class="row" data-id="${u.id}">
      <div class="row-main">
        <div class="row-top">
          <b>${esc(u.display_name || u.username || u.id.slice(0, 8))}</b>
          ${u.role === 'admin' ? '<span class="chip gold">admin</span>' : ''}
          ${u.is_blocked      ? '<span class="chip bad">bloqueado</span>' : ''}
          <span class="muted">${u.created_at ? fmtDate(u.created_at) : ''}</span>
        </div>
        ${u.blocked_reason ? `<p class="row-body muted">Motivo: ${esc(u.blocked_reason)}</p>` : ''}
      </div>
      <div class="row-acts">
        <button class="b" data-act="block">${u.is_blocked ? 'Desbloquear' : 'Bloquear'}</button>
        <button class="b" data-act="admin" ${u.id === ME.id ? 'disabled' : ''}>${u.role === 'admin' ? 'Remover admin' : 'Tornar admin'}</button>
      </div>
    </div>`).join('');

  wrap.onclick = async e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const row = btn.closest('.row'), id = row.dataset.id;

    if (btn.dataset.act === 'block') {
      const isBlocked = !!row.querySelector('.chip.bad');
      let patch = { is_blocked: !isBlocked, blocked_reason: null, blocked_at: null };
      if (!isBlocked) {
        const reason = prompt('Motivo do bloqueio (opcional):') || null;
        patch = { is_blocked: true, blocked_reason: reason, blocked_at: new Date().toISOString() };
      }
      const { error } = await supabase.from('profiles').update(patch).eq('id', id);
      if (error) return toast(error.message, 'bad');
      await log('user.block', id, patch);
      toast(patch.is_blocked ? 'Usuário bloqueado.' : 'Usuário desbloqueado.'); loadUsers();
    } else {
      const isAdmin = !!row.querySelector('.chip.gold');
      if (!await confirmAction(isAdmin ? 'Remover permissão de admin?' : 'Conceder permissão TOTAL de admin?')) return;
      const newRole = isAdmin ? 'user' : 'admin';
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
      if (error) return toast(error.message, 'bad');
      await log('user.admin', id, { role: newRole }); toast('Permissão atualizada.'); loadUsers();
    }
  };
}
$('#userSearch')?.addEventListener('input', debounce(loadUsers, 350));

/* ---------------- 6. TEXTOS DO SITE ---------------- */
async function loadTexts() {
  const wrap = $('#textsList');
  wrap.innerHTML = '<div class="skel tall"></div>';
  const { data, error } = await supabase.from('site_content').select('*').order('key');
  if (error) return wrap.innerHTML = err(error);
  if (!data?.length) return wrap.innerHTML = empty('Nenhum texto cadastrado.');

  wrap.innerHTML = data.map(t => `
    <div class="txt-row" data-key="${esc(t.key)}">
      <div class="txt-meta"><code>${esc(t.key)}</code><span class="muted">${esc(t.description || '')}</span></div>
      <textarea rows="2">${esc(t.value)}</textarea>
      <button class="b" data-act="save">Salvar</button>
    </div>`).join('');

  wrap.onclick = async e => {
    const btn = e.target.closest('button[data-act="save"]'); if (!btn) return;
    const row = btn.closest('.txt-row');
    const key = row.dataset.key, value = $('textarea', row).value;
    const { error } = await supabase.from('site_content')
      .update({ value, updated_at: new Date().toISOString(), updated_by: ME.id }).eq('key', key);
    if (error) return toast(error.message, 'bad');
    await log('text.update', key, { value: value.slice(0, 120) });
    toast('Texto atualizado.');
  };
}

$('#textNew')?.addEventListener('click', async () => {
  const key = prompt('Chave do texto (ex: home.footer.aviso):'); if (!key) return;
  const { error } = await supabase.from('site_content')
    .insert({ key: key.trim(), value: '', description: prompt('Onde aparece?') || null });
  if (error) return toast(error.message, 'bad');
  toast('Texto criado.'); loadTexts();
});

/* ---------------- 7. LOGS ---------------- */
async function loadLogs() {
  const wrap = $('#logsList');
  wrap.innerHTML = '<div class="skel tall"></div>';
  const { data, error } = await supabase.from('admin_log')
    .select('*, profiles(username)').order('created_at', { ascending: false }).limit(200);
  if (error) return wrap.innerHTML = err(error);
  if (!data?.length) return wrap.innerHTML = empty('Nenhuma ação registrada ainda.');

  wrap.innerHTML = `<table class="tbl"><thead><tr><th>Quando</th><th>Admin</th><th>Ação</th><th>Alvo</th></tr></thead><tbody>
    ${data.map(l => `<tr>
      <td class="muted">${fmtDate(l.created_at)}</td>
      <td>${esc(l.profiles?.username || '—')}</td>
      <td><code>${esc(l.action)}</code></td>
      <td class="muted">${esc(l.target || '')}</td>
    </tr>`).join('')}</tbody></table>`;
}

/* ---------------- helpers ---------------- */
function err(e)   { return `<div class="empty bad">Erro: ${esc(e.message)}</div>`; }
function empty(m) { return `<div class="empty">${esc(m)}</div>`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

boot();

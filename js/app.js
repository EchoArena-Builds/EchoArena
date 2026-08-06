import { supabase } from './supabase.js';
import { loadSiteStats, loadHeroHighlights } from './stats.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  session: null,
  role: null,
  maintenance: false,
  heroes: [],
  builds: [],
  authMode: 'login'
};

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

const isVideo = (source = '', mime = '') =>
  mime.startsWith('video/') || /\.(mp4|webm)$/i.test(source);

/* =========================================================
   MÍDIA
   Cada destino tem sua própria imagem e seu próprio
   enquadramento. "slot" define qual usar:
     main → spotlight
     card → cards de herói
     gif  → animação
========================================================= */

function mediaOf(hero = {}, slot = 'main') {
  const chain = slot === 'card'
    ? ['card', 'main', 'gif']
    : slot === 'gif'
      ? ['gif', 'main', 'card']
      : ['main', 'card', 'gif'];

  for (const key of chain) {
    const source = hero[`${key}_source`];

    if (source) {
      return {
        source,
        mime_type: hero[`${key}_mime_type`] || '',
        scale:     hero[`${key}_scale`] ?? 1,
        offset_x:  hero[`${key}_offset_x`] ?? 0,
        offset_y:  hero[`${key}_offset_y`] ?? 0,
        fit:       hero.fit || 'cover',
        anchor_x:  hero.anchor_x || '50%',
        anchor_y:  hero.anchor_y || '50%'
      };
    }
  }

  return null;
}

function mediaStyle(media, fit) {
  if (!media) return '';

  const pos = `${media.anchor_x || '50%'} ${media.anchor_y || '50%'}`;

  return [
    `--fit:${fit || media.fit || 'cover'}`,
    `--pos:${pos}`,
    `--scale:${Number(media.scale ?? 1)}`,
    `--x:${Number(media.offset_x ?? 0)}%`,
    `--y:${Number(media.offset_y ?? 0)}%`
  ].join(';');
}

function mediaInner(media, alt = '') {
  if (!media?.source) return '';

  return isVideo(media.source, media.mime_type || '')
    ? `<video src="${escapeHtml(media.source)}" autoplay muted loop playsinline></video>`
    : `<img src="${escapeHtml(media.source)}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

/* =========================================================
   COR DA CLASSE
   Vem de hero_classes.color, editável no painel.
   Sem cor definida, usa uma paleta estável derivada do slug —
   o mesmo slug sempre recebe a mesma cor.
========================================================= */

const CLASS_PALETTE = [
  '#F4D77A', '#8FE9FF', '#B794FF', '#4ADE80',
  '#F87171', '#FBBF24', '#67E8F9', '#F0A6D0'
];

function classColor(hero = {}) {
  const stored = String(hero.class_color || '').trim();

  if (/^#[0-9a-f]{3,8}$/i.test(stored)) return stored;

  const key = String(hero.class_slug || hero.class_name || hero.slug || '');
  let sum = 0;

  for (let i = 0; i < key.length; i += 1) {
    sum = (sum + key.charCodeAt(i)) % 997;
  }

  return CLASS_PALETTE[sum % CLASS_PALETTE.length];
}

/* =========================================================
   AUTENTICAÇÃO
========================================================= */

function showMessage(message, type = '') {
  const el = $('#auth-message');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${type}`.trim();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';

  $('#auth-title').textContent = register ? 'Criar conta' : 'Entrar';
  $('#auth-submit').textContent = register ? 'Registrar' : 'Entrar';
  $('#auth-switch-text').textContent = register ? 'Já tem uma conta?' : 'Ainda não tem conta?';
  $('#auth-switch-btn').textContent = register ? 'Entrar' : 'Registrar';
  $('#name-field').hidden = !register;
  $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
  showMessage('');
}

function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('#auth-modal').classList.add('open');
  $('#auth-modal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#auth-email').focus(), 0);
}

function closeAuth() {
  $('#auth-modal').classList.remove('open');
  $('#auth-modal').setAttribute('aria-hidden', 'true');
  $('#auth-form').reset();
  showMessage('');
}

/* =========================================================
   HERÓIS
========================================================= */

async function loadHeroes(classSlug = '') {
  const container = $('#heroes');
  container.innerHTML = '<div class="loading-card">Carregando heróis...</div>';

  let query = supabase
    .from('v_heroes_complete')
    .select('*')
    .eq('enabled', true)
    .order('name')
    .limit(60);

  if (classSlug) query = query.eq('class_slug', classSlug);

  const { data, error } = await query;

  if (error) {
    console.error(error);
    container.innerHTML = '<div class="loading-card">Não foi possível carregar os heróis.</div>';
    return;
  }

  state.heroes = data || [];

  container.innerHTML = state.heroes.slice(0, 12).map((hero) => {
    const media = mediaOf(hero, 'card');
    const color = classColor(hero);

    return `
      <article class="hc" data-hero="${escapeHtml(hero.slug)}"
               style="--class-color:${escapeHtml(color)}">
        <div class="thumb">
          <div class="media ${media ? '' : 'empty'}"
               style="${mediaStyle(media, 'cover')}">
            ${mediaInner(media, hero.name)}
          </div>
          <div class="fade"></div>
          <div class="cap">
            <div class="n" style="color:${escapeHtml(color)}">
              ${escapeHtml(hero.name)}
            </div>
            <div class="r">${escapeHtml(hero.class_name || '')}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  renderSpotlight(state.heroes[0]);
}

function renderSpotlight(hero) {
  if (!hero) return;

  loadHeroHighlights(hero);

  $('#sp-name').textContent = hero.name || '';
  $('#sp-sub').textContent = hero.subtitle || hero.class_name || '';
  $('.spot .desc').textContent = hero.description || 'Informações em atualização.';

  /* O spotlight muda muito de proporção entre desktop e celular.
     "contain" garante o herói inteiro visível em qualquer largura. */
  const media = mediaOf(hero, 'main');
  const element = $('#spot-media');

  element.setAttribute('style', mediaStyle(media, 'contain'));
  element.innerHTML = mediaInner(media, hero.name);
  element.classList.toggle('empty', !media);
}

/* =========================================================
   BUILDS
========================================================= */

async function loadBuilds() {
  const container = $('#builds');
  container.innerHTML = '<div class="loading-card">Carregando builds...</div>';

  const { data, error } = await supabase
    .from('v_popular_builds')
    .select('*')
    .limit(10);

  if (error) {
    console.error(error);
    container.innerHTML = '<div class="loading-card">Ainda não há builds públicas.</div>';
    return;
  }

  state.builds = data || [];

  container.innerHTML = state.builds.length
    ? state.builds.map((build) => `
      <div class="brow">
        <div class="who">
          <div class="av media empty"></div>
          <div>
            <div class="nm">${escapeHtml(build.title)}</div>
            <div class="by">Por <b>${escapeHtml(build.display_name || build.username || 'Jogador')}</b></div>
          </div>
        </div>
        <div></div>
        <div class="m">
          <div class="v g">${Number(build.likes || 0).toLocaleString('pt-BR')}</div>
          <div class="l">Favoritos</div>
        </div>
        <div class="items">${'<i></i>'.repeat(6)}</div>
        <button class="go" data-build="${build.id}">Ver build</button>
      </div>
    `).join('')
    : '<div class="loading-card">Nenhuma build publicada ainda.</div>';
}

async function loadSavedBuilds() {
  const container = $('#saved');

  if (!state.session?.user) {
    container.innerHTML = '<div class="loading-card">Entre para ver suas builds.</div>';
    return;
  }

  const { data, error } = await supabase
    .from('builds')
    .select('id,title,updated_at')
    .eq('user_id', state.session.user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error(error);
    container.innerHTML = '<div class="loading-card">Não foi possível carregar suas builds.</div>';
    return;
  }

  container.innerHTML = data?.length
    ? data.map((build) => `
      <div class="r">
        <div class="av media empty"></div>
        <div class="tx">
          <div class="n">${escapeHtml(build.title)}</div>
          <div class="d">Atualizada em ${new Date(build.updated_at).toLocaleDateString('pt-BR')}</div>
        </div>
        <div class="ii">${'<i></i>'.repeat(5)}</div>
        <span class="hz">♥</span>
      </div>
    `).join('')
    : '<div class="loading-card">Você ainda não salvou builds.</div>';
}

/* =========================================================
   SESSÃO
========================================================= */

/* =========================================================
   SAÍDA DA CONTA
   Sair do login remove privilégios na hora. Para admin isso
   pode significar perder o acesso ao próprio site — então a
   ação pede confirmação explícita.
========================================================= */

async function loadAccountContext() {
  state.role = null;
  state.maintenance = false;

  const userId = state.session?.user?.id;
  if (!userId) return;

  try {
    const [profileResult, statusResult] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
      supabase.rpc('site_status')
    ]);

    state.role = profileResult.data?.role ?? null;

    const status = Array.isArray(statusResult.data)
      ? statusResult.data[0]
      : statusResult.data;

    state.maintenance = status?.maintenance_mode === true;
  } catch (error) {
    console.warn('[conta] contexto indisponível:', error.message);
  }
}

function confirmLogout() {
  const isAdmin = state.role === 'admin';

  /* Usuário comum sai sem cerimônia. */
  if (!isAdmin) return Promise.resolve(true);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'logout-modal';

    const extra = state.maintenance
      ? `<div class="lg-alert">
           O site está <strong>em manutenção</strong>. Ao sair, esta página
           deixa de abrir para você até que faça login novamente.
         </div>`
      : '';

    overlay.innerHTML = `
      <div class="lg-backdrop"></div>

      <div class="lg-card" role="dialog" aria-modal="true">
        <div class="lg-icon">&#9888;</div>

        <h2>Sair da conta de administrador?</h2>

        <p>
          Você perde o acesso administrativo nesta aba. Recursos que exigem
          login voltam a pedir autenticação, e será necessário entrar de novo
          pelo painel para retomar a administração.
        </p>

        ${extra}

        <div class="lg-actions">
          <button type="button" id="lg-cancel">Continuar conectado</button>
          <button type="button" id="lg-confirm" class="danger">Sair mesmo assim</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');

    style.textContent = `
      #logout-modal{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;
        font-family:Inter,system-ui,sans-serif}
      #logout-modal .lg-backdrop{position:absolute;inset:0;background:rgba(3,7,15,.82);
        backdrop-filter:blur(5px)}
      #logout-modal .lg-card{position:relative;width:min(440px,100%);padding:26px;
        border:1px solid #71303b;border-radius:18px;background:#130E24;
        box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}
      #logout-modal .lg-icon{font-size:32px;line-height:1;margin-bottom:12px;color:#ffb4bd}
      #logout-modal h2{margin:0 0 10px;font-size:19px;color:#EDE9F7}
      #logout-modal p{margin:0;color:#A79CC8;font-size:12.5px;line-height:1.65}
      #logout-modal .lg-alert{margin-top:14px;padding:12px 14px;border:1px solid #71303b;
        border-radius:11px;background:#2a1016;color:#ffb4bd;font-size:12px;line-height:1.6}
      #logout-modal .lg-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:20px}
      #logout-modal .lg-actions button{padding:12px;border:1px solid #31245C;border-radius:10px;
        background:#181130;color:#EDE9F7;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer}
      #logout-modal .lg-actions button.danger{border-color:#71303b;background:#2a1016;color:#ff9aaa}
      @media(max-width:420px){#logout-modal .lg-actions{grid-template-columns:1fr}}
    `;

    overlay.appendChild(style);
    document.body.appendChild(overlay);

    function close(result) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }

    function onKey(event) {
      if (event.key === 'Escape') close(false);
    }

    overlay.querySelector('#lg-confirm').addEventListener('click', () => close(true));
    overlay.querySelector('#lg-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.lg-backdrop').addEventListener('click', () => close(false));
    document.addEventListener('keydown', onKey);

    setTimeout(() => overlay.querySelector('#lg-cancel')?.focus(), 30);
  });
}

function updateAuthUI() {
  const loginButton = $('#login-btn');
  const registerButton = $('#register-btn');

  if (state.session?.user) {
    loginButton.textContent = 'Sair';
    loginButton.onclick = async () => {
      if (await confirmLogout()) {
        await supabase.auth.signOut();
      }
    };
    registerButton.textContent = state.session.user.email || 'Minha conta';
    registerButton.disabled = true;
  } else {
    loginButton.textContent = 'Entrar';
    loginButton.onclick = () => openAuth('login');
    registerButton.textContent = 'Registrar';
    registerButton.disabled = false;
    registerButton.onclick = () => openAuth('register');
  }

  loadSavedBuilds();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  showMessage('Processando...');

  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const displayName = $('#auth-name').value.trim();

  if (state.authMode === 'register') {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });

    if (error) return showMessage(error.message, 'error');

    showMessage(
      'Sua conta foi criada com sucesso. Enviamos um e-mail de confirmação. ' +
      'Após validar seu endereço de e-mail, você poderá acessar todos os recursos da plataforma.',
      'success'
    );
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showMessage(error.message, 'error');

  closeAuth();
}

async function resetPassword() {
  const email = $('#auth-email').value.trim();
  if (!email) return showMessage('Digite seu e-mail primeiro.', 'error');

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  if (error) return showMessage(error.message, 'error');
  showMessage('Enviamos o link de recuperação para seu e-mail.', 'success');
}

/* =========================================================
   EVENTOS
========================================================= */

function bindEvents() {
  $('#auth-close').onclick = closeAuth;

  $('#auth-modal').onclick = (event) => {
    if (event.target.id === 'auth-modal') closeAuth();
  };

  $('#auth-form').addEventListener('submit', handleAuthSubmit);

  $('#auth-switch-btn').onclick = () =>
    setAuthMode(state.authMode === 'login' ? 'register' : 'login');

  $('#forgot-password-btn').onclick = resetPassword;

  $('#promo-login-btn').onclick = () => openAuth('login');
  $('#promo-register-btn').onclick = () => openAuth('register');

  $('#create-build-btn').onclick = () => {
    if (!state.session?.user) return openAuth('login');
    window.location.href = './criar-build.html';
  };

  $('#bg').onclick = () => $('#side').classList.toggle('open');

  $$('.filters b').forEach((button) => {
    button.onclick = () => {
      $$('.filters b').forEach((item) => item.classList.remove('on'));
      button.classList.add('on');
      loadHeroes(button.dataset.class || '');
    };
  });
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function bootstrap() {
  /* O porteiro já substituiu a página — não há o que montar. */
  if (window.__ECHO_BLOCKED) return;

  bindEvents();

  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  await loadAccountContext();
  updateAuthUI();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    await loadAccountContext();
    updateAuthUI();
  });

  await Promise.all([loadHeroes(), loadBuilds(), loadSiteStats()]);
}

bootstrap().catch((error) => {
  console.error('[Echo Arena]', error);
});

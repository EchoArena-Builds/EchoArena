import { supabase } from './supabase.js';

/* =========================================================
   CASCA COMPARTILHADA DO SITE PÚBLICO

   Monta topbar, menu lateral, barra de status e modal de
   autenticação em qualquer página. Cada página só escreve
   o próprio conteúdo.

   USO na página:

     import { initSiteShell } from './js/site-shell.js';
     const shell = await initSiteShell({ activeId: 'herois' });

   O HTML da página é preservado por inteiro — inclusive painéis
   laterais, modais e elementos fora de qualquer contêiner. Não é
   preciso marcar nada.
   ========================================================= */

/* =========================================================
   TRAVA DE PINTURA
   O guard.js já esconde a página, mas ele some assim que
   libera. Esta trava cobre o intervalo entre a liberação e
   a montagem da casca, evitando o conteúdo cru piscar.
========================================================= */

const PAINT_GUARD_ID = 'site-paint-guard';

(function hideUntilReady() {
  if (document.getElementById(PAINT_GUARD_ID)) return;

  const style = document.createElement('style');
  style.id = PAINT_GUARD_ID;
  style.textContent = 'body{visibility:hidden !important}';

  (document.head || document.documentElement).appendChild(style);

  setTimeout(revealPage, 8000);
})();

function revealPage() {
  document.getElementById(PAINT_GUARD_ID)?.remove();
}

/* ---------------------------------------------------------
   MENU — fonte única. Página nova? Acrescente aqui.
--------------------------------------------------------- */
const MAIN_NAV = [
  { id: 'herois',       label: 'Heróis',       href: './herois.html' },
  { id: 'classes',      label: 'Classes',      href: './classes.html' },
  { id: 'builds',       label: 'Builds',       href: './builds.html' },
  { id: 'equipamentos', label: 'Equipamentos', href: './equipamentos.html' },
  { id: 'estatisticas', label: 'Estatísticas', href: './estatisticas.html' },
  { id: 'composicoes',  label: 'Composições',  href: './composicoes.html' },
  { id: 'tier-list',    label: 'Tier List',    href: './tier-list.html' }
];

const SIDE_NAV = [
  { id: 'inicio',       label: 'Início',       href: './index.html',        icon: '⌂' },
  { id: 'herois',       label: 'Heróis',       href: './herois.html',       icon: '👤' },
  { id: 'builds',       label: 'Builds',       href: './builds.html',       icon: '⚙' },
  { id: 'composicoes',  label: 'Composições',  href: './composicoes.html',  icon: '🛡' },
  { id: 'estatisticas', label: 'Estatísticas', href: './estatisticas.html', icon: '📊' },
  { id: 'equipamentos', label: 'Equipamentos', href: './equipamentos.html', icon: '⚔' },
  { id: 'tier-list',    label: 'Tier List',    href: './tier-list.html',    icon: '🏆' },
  { id: 'guias',        label: 'Guias',        href: './guias.html',        icon: '📄' },
  { id: 'noticias',     label: 'Notícias',     href: './noticias.html',     icon: '📰' }
];

/* ---------------------------------------------------------
   ESTADO
--------------------------------------------------------- */
const state = {
  session: null,
  role: null,
  maintenance: false,
  authMode: 'login'
};

/* ---------------------------------------------------------
   UTILITÁRIOS
--------------------------------------------------------- */
const $ = (selector) => document.querySelector(selector);

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

export function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('pt-BR', {
    notation: number >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(number);
}

/* Cor da classe: vem do banco, com paleta estável por slug. */
const CLASS_PALETTE = [
  '#F4D77A', '#8FE9FF', '#B794FF', '#4ADE80',
  '#F87171', '#FBBF24', '#67E8F9', '#F0A6D0'
];

export function classColor(item = {}) {
  const stored = String(item.class_color || item.color || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(stored)) return stored;

  const key = String(item.class_slug || item.slug || item.class_name || '');
  let sum = 0;

  for (let i = 0; i < key.length; i += 1) {
    sum = (sum + key.charCodeAt(i)) % 997;
  }

  return CLASS_PALETTE[sum % CLASS_PALETTE.length];
}

/* Mídia por destino, igual ao spotlight e aos cards. */
export function mediaOf(hero = {}, slot = 'main') {
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
        anchor_x:  hero.anchor_x || '50%',
        anchor_y:  hero.anchor_y || '50%'
      };
    }
  }

  return null;
}

export function mediaStyle(media, fit = 'cover') {
  if (!media) return '';

  return [
    `--fit:${fit}`,
    `--pos:${media.anchor_x || '50%'} ${media.anchor_y || '50%'}`,
    `--scale:${Number(media.scale ?? 1)}`,
    `--x:${Number(media.offset_x ?? 0)}%`,
    `--y:${Number(media.offset_y ?? 0)}%`
  ].join(';');
}

export function mediaInner(media, alt = '') {
  if (!media?.source) return '';

  const isVideo = (media.mime_type || '').startsWith('video/') ||
                  /\.(mp4|webm)$/i.test(media.source);

  return isVideo
    ? `<video src="${escapeHtml(media.source)}" autoplay muted loop playsinline></video>`
    : `<img src="${escapeHtml(media.source)}" alt="${escapeHtml(alt)}" loading="lazy">`;
}

/* ---------------------------------------------------------
   MONTAGEM
--------------------------------------------------------- */
function renderShell({ activeId, withRail }) {
  /* Preserva TODOS os nós da página, não só o contêiner marcado.
     Painéis laterais, modais e qualquer elemento solto sobrevivem.
     Mover nós (em vez de copiar innerHTML) também mantém os
     listeners já registrados. */
  const preserved = document.createDocumentFragment();

  while (document.body.firstChild) {
    preserved.appendChild(document.body.firstChild);
  }

  const mainNav = MAIN_NAV.map(item => `
    <a href="${item.href}" class="${item.id === activeId ? 'on' : ''}">
      ${escapeHtml(item.label)}
    </a>
  `).join('');

  const sideNav = SIDE_NAV.map(item => `
    <a href="${item.href}" class="${item.id === activeId ? 'on' : ''}">
      <span class="ic">${item.icon}</span>${escapeHtml(item.label)}
    </a>
  `).join('');

  document.body.innerHTML = `
    <div class="topbar">
      <a class="brand" href="./index.html">
        <span class="mk"></span>ECHO<span>ARENA</span>
      </a>

      <nav class="mainnav">${mainNav}</nav>

      <div class="srch">
        <input id="global-search" placeholder="Buscar heróis, habilidades...">
        <span class="kb">/</span>
      </div>

      <button class="btn-o" id="login-btn">Entrar</button>
      <button class="btn-g" id="register-btn">Registrar</button>
      <button class="burger" id="bg">☰</button>
    </div>

    <div class="shell ${withRail ? 'with-rail' : ''}">
      <aside class="side" id="side">
        <nav class="snav">${sideNav}</nav>

        <div class="promo">
          <div class="st">★</div>
          <p>Salve suas builds, compare e domine o campo de batalha!</p>
          <a class="cta" id="promo-register-btn">Criar conta</a>
          <div class="lg">Já tem uma conta? <a id="promo-login-btn">Entrar</a></div>
        </div>
      </aside>

      <main class="col" id="site-main"></main>
    </div>

    <div class="auth-modal" id="auth-modal" aria-hidden="true">
      <div class="auth-card">
        <div class="auth-head">
          <h2 id="auth-title">Entrar</h2>
          <button class="auth-close" id="auth-close" aria-label="Fechar">✕</button>
        </div>

        <form class="auth-form" id="auth-form">
          <label id="name-field" hidden>
            Nome de exibição
            <input id="auth-name" type="text" minlength="2" maxlength="40" autocomplete="name">
          </label>

          <label>
            E-mail
            <input id="auth-email" type="email" required autocomplete="email">
          </label>

          <label>
            Senha
            <input id="auth-password" type="password" required minlength="8"
                   autocomplete="current-password">
          </label>

          <button class="auth-submit" type="submit" id="auth-submit">Entrar</button>

          <div class="auth-message" id="auth-message"></div>

          <div class="auth-switch">
            <span id="auth-switch-text">Ainda não tem conta?</span>
            <button type="button" id="auth-switch-btn">Registrar</button>
          </div>

          <button type="button" id="forgot-password-btn" class="auth-switch">
            Esqueci minha senha
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('site-main').appendChild(preserved);
  revealPage();
}

/* ---------------------------------------------------------
   AUTENTICAÇÃO
--------------------------------------------------------- */
function showMessage(text, type = '') {
  const element = $('#auth-message');
  if (!element) return;
  element.textContent = text;
  element.className = `auth-message ${type}`.trim();
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

export function openAuth(mode = 'login') {
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
      'Conta criada. Enviamos um e-mail de confirmação — valide seu endereço ' +
      'para liberar todos os recursos.',
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

/* Sair sendo admin apaga privilégios — confirma antes. */
function confirmLogout() {
  if (state.role !== 'admin') return Promise.resolve(true);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'logout-modal';

    const extra = state.maintenance
      ? `<div class="lg-alert">O site está <strong>em manutenção</strong>.
           Ao sair, esta página deixa de abrir para você até novo login.</div>`
      : '';

    overlay.innerHTML = `
      <div class="lg-backdrop"></div>
      <div class="lg-card" role="dialog" aria-modal="true">
        <div class="lg-icon">&#9888;</div>
        <h2>Sair da conta de administrador?</h2>
        <p>Você perde o acesso administrativo nesta aba e recursos protegidos
           voltam a pedir login.</p>
        ${extra}
        <div class="lg-actions">
          <button type="button" id="lg-cancel">Continuar conectado</button>
          <button type="button" id="lg-confirm" class="danger">Sair mesmo assim</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #logout-modal{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px}
      #logout-modal .lg-backdrop{position:absolute;inset:0;background:rgba(3,7,15,.82);backdrop-filter:blur(5px)}
      #logout-modal .lg-card{position:relative;width:min(440px,100%);padding:26px;border:1px solid #71303b;
        border-radius:18px;background:#130E24;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}
      #logout-modal .lg-icon{font-size:32px;line-height:1;margin-bottom:12px;color:#ffb4bd}
      #logout-modal h2{margin:0 0 10px;font-size:19px}
      #logout-modal p{margin:0;color:#A79CC8;font-size:12.5px;line-height:1.65}
      #logout-modal .lg-alert{margin-top:14px;padding:12px 14px;border:1px solid #71303b;border-radius:11px;
        background:#2a1016;color:#ffb4bd;font-size:12px;line-height:1.6}
      #logout-modal .lg-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:20px}
      #logout-modal .lg-actions button{padding:12px;border:1px solid #31245C;border-radius:10px;
        background:#181130;color:#EDE9F7;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer}
      #logout-modal .lg-actions button.danger{border-color:#71303b;background:#2a1016;color:#ff9aaa}
      @media(max-width:420px){#logout-modal .lg-actions{grid-template-columns:1fr}}
    `;

    overlay.appendChild(style);
    document.body.appendChild(overlay);

    const close = (result) => { overlay.remove(); resolve(result); };

    overlay.querySelector('#lg-confirm').onclick = () => close(true);
    overlay.querySelector('#lg-cancel').onclick = () => close(false);
    overlay.querySelector('.lg-backdrop').onclick = () => close(false);
  });
}

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
    console.warn('[shell] contexto indisponível:', error.message);
  }
}

function updateAuthUI() {
  const loginButton = $('#login-btn');
  const registerButton = $('#register-btn');
  if (!loginButton || !registerButton) return;

  if (state.session?.user) {
    loginButton.textContent = 'Sair';
    loginButton.onclick = async () => {
      if (await confirmLogout()) await supabase.auth.signOut();
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
}

function bindShellEvents() {
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
  $('#bg').onclick = () => $('#side').classList.toggle('open');
}

/* ---------------------------------------------------------
   API PÚBLICA
--------------------------------------------------------- */
export async function initSiteShell({ activeId = '', withRail = false } = {}) {
  /* O porteiro já substituiu a página. */
  if (window.__ECHO_BLOCKED) {
    revealPage();
    return null;
  }

  renderShell({ activeId, withRail });
  bindShellEvents();

  const { data } = await supabase.auth.getSession();
  state.session = data.session;

  await loadAccountContext();
  updateAuthUI();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    await loadAccountContext();
    updateAuthUI();
  });

  return {
    state,
    supabase,
    openAuth,
    requireLogin() {
      if (state.session?.user) return true;
      openAuth('login');
      return false;
    }
  };
}

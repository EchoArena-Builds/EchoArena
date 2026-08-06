import { supabase } from '../../js/supabase.js';
import { requireAdmin } from './admin-auth.js';

/* =========================================================
   TRAVA DE PINTURA
   Esconde a página no instante em que o módulo é avaliado,
   antes de o navegador desenhar o conteúdo cru. Só revela
   quando a casca terminou de montar — ou depois de um tempo
   máximo, para uma falha nunca deixar a tela em branco.
========================================================= */

const PAINT_GUARD_ID = 'admin-paint-guard';

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

const DEFAULT_MENU = [
  { id: 'dashboard', label: 'Dashboard', href: './index.html' },
  {
    id: 'heroes',
    label: 'Heróis',
    children: [
      { id: 'heroes-list', label: 'Lista', href: './heroes.html' },
      { id: 'hero-new', label: 'Novo herói', href: './hero-editor.html' },
      { id: 'hero-stats', label: 'Status', href: './hero-stats.html' }
    ]
  },
  {
    id: 'equipments',
    label: 'Equipamentos',
    children: [
      { id: 'equipments-list', label: 'Lista', href: './equipments.html' },
      { id: 'equipment-new', label: 'Novo equipamento', href: './equipment-editor.html' },
      { id: 'equipment-ai-import', label: 'Importar por JSON', href: './equipment-ai-import.html' },
    ]
  },
  { id: 'classes', label: 'Classes', href: './classes.html' },
  { id: 'builds', label: 'Builds', href: './builds.html' },
  { id: 'comments', label: 'Comentários', href: './comments.html' },
  { id: 'users', label: 'Usuários', href: './users.html' },
  { id: 'site-texts', label: 'Textos do site', href: './site-texts.html' }
];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizePath(pathname) {
  return pathname
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

function currentFile() {
  const path = normalizePath(location.pathname);
  return path.split('/').pop() || 'index.html';
}

function isActiveItem(item, activeId) {
  if (activeId && item.id === activeId) return true;

  if (item.href) {
    const target = item.href.split('/').pop()?.toLowerCase();
    return target === currentFile();
  }

  return item.children?.some(child => isActiveItem(child, activeId)) ?? false;
}

function renderMenu(items, activeId) {
  return items.map(item => {
    const active = isActiveItem(item, activeId);

    if (item.children?.length) {
      const children = item.children.map(child => {
        const childActive = isActiveItem(child, activeId);

        return `
          <a
            class="admin-shell-subitem ${childActive ? 'is-active' : ''}"
            href="${child.href}"
            data-menu-id="${child.id}"
          >
            ${escapeHtml(child.label)}
          </a>
        `;
      }).join('');

      return `
        <div class="admin-shell-group ${active ? 'is-open' : ''}">
          <button
            type="button"
            class="admin-shell-group-trigger ${active ? 'is-active' : ''}"
            aria-expanded="${active ? 'true' : 'false'}"
          >
            <span>${escapeHtml(item.label)}</span>
            <span class="admin-shell-chevron">⌄</span>
          </button>

          <div class="admin-shell-submenu">
            ${children}
          </div>
        </div>
      `;
    }

    return `
      <a
        class="admin-shell-item ${active ? 'is-active' : ''}"
        href="${item.href}"
        data-menu-id="${item.id}"
      >
        ${escapeHtml(item.label)}
      </a>
    `;
  }).join('');
}

async function getCurrentAdmin() {
  const isCodespacesPreview =
    location.hostname.endsWith('.app.github.dev');

  // Apenas para testar localmente no Codespaces.
  // Não afeta o GitHub Pages nem o site publicado.
  if (isCodespacesPreview) {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    return {
      session: session ?? null,
      email: session?.user?.email ?? 'preview@codespaces.local',
      displayName:
        session?.user?.user_metadata?.display_name ||
        session?.user?.email ||
        'Preview administrativo'
    };
  }

  // Produção continua protegida.
  const { session, profile } = await requireAdmin();

  return {
    session,
    profile,
    email: session.user.email ?? '',
    displayName:
      profile?.display_name ||
      profile?.username ||
      session.user.email ||
      'Administrador'
  };
}

function setPageTitle(title, subtitle) {
  const titleElement = document.querySelector('[data-admin-page-title]');
  const subtitleElement = document.querySelector('[data-admin-page-subtitle]');

  if (titleElement && title) {
    titleElement.textContent = title;
  }

  if (subtitleElement) {
    subtitleElement.textContent = subtitle ?? '';
  }
}

function bindNavigation() {
  document.querySelectorAll('.admin-shell-group-trigger').forEach(button => {
    button.addEventListener('click', () => {
      const group = button.closest('.admin-shell-group');
      const opened = group.classList.toggle('is-open');

      button.setAttribute('aria-expanded', String(opened));
    });
  });

  const mobileButton = document.getElementById('admin-shell-mobile-toggle');
  const sidebar = document.getElementById('admin-shell-sidebar');
  const backdrop = document.getElementById('admin-shell-backdrop');

  const closeMobile = () => {
    sidebar?.classList.remove('is-mobile-open');
    backdrop?.classList.remove('is-visible');
    document.body.classList.remove('admin-shell-lock');
  };

  mobileButton?.addEventListener('click', () => {
    sidebar?.classList.toggle('is-mobile-open');
    backdrop?.classList.toggle('is-visible');
    document.body.classList.toggle('admin-shell-lock');
  });

  backdrop?.addEventListener('click', closeMobile);

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      closeMobile();
    }
  });
}

/* =========================================================
   CONFIRMAÇÃO DE SAÍDA
   Sair encerra a sessão administrativa. Se o site estiver em
   manutenção, isso também derruba seu acesso ao site público.
========================================================= */

async function confirmAdminLogout() {
  let maintenance = false;

  try {
    const { data } = await supabase.rpc('site_status');
    const status = Array.isArray(data) ? data[0] : data;
    maintenance = status?.maintenance_mode === true;
  } catch (error) {
    console.warn('[logout] estado do site indisponível:', error.message);
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'admin-logout-modal';

    const extra = maintenance
      ? `<div class="al-alert">
           O site está <strong>em manutenção</strong>. Sem sessão de
           administrador, nem o painel nem o site público abrem para você
           até fazer login novamente.
         </div>`
      : '';

    overlay.innerHTML = `
      <div class="al-backdrop"></div>

      <div class="al-card" role="dialog" aria-modal="true">
        <div class="al-icon">&#9888;</div>

        <h2>Encerrar sessão administrativa?</h2>

        <p>
          Alterações não salvas serão perdidas e você precisará entrar
          novamente para voltar ao painel.
        </p>

        ${extra}

        <div class="al-actions">
          <button type="button" id="al-cancel">Permanecer no painel</button>
          <button type="button" id="al-confirm" class="danger">Sair</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');

    style.textContent = `
      #admin-logout-modal{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
        padding:20px;font-family:Inter,system-ui,sans-serif}
      #admin-logout-modal .al-backdrop{position:absolute;inset:0;background:rgba(3,7,15,.82);
        backdrop-filter:blur(5px)}
      #admin-logout-modal .al-card{position:relative;width:min(440px,100%);padding:26px;
        border:1px solid #71303b;border-radius:18px;background:#12101f;
        box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}
      #admin-logout-modal .al-icon{font-size:32px;line-height:1;margin-bottom:12px;color:#ffb4bd}
      #admin-logout-modal h2{margin:0 0 10px;font-size:19px;color:#eef2f8}
      #admin-logout-modal p{margin:0;color:#9aa4bb;font-size:12.5px;line-height:1.65}
      #admin-logout-modal .al-alert{margin-top:14px;padding:12px 14px;border:1px solid #71303b;
        border-radius:11px;background:#2a1016;color:#ffb4bd;font-size:12px;line-height:1.6}
      #admin-logout-modal .al-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:20px}
      #admin-logout-modal .al-actions button{padding:12px;border:1px solid #31245c;border-radius:10px;
        background:#161331;color:#eef2f8;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer}
      #admin-logout-modal .al-actions button.danger{border-color:#71303b;background:#2a1016;color:#ff9aaa}
      @media(max-width:420px){#admin-logout-modal .al-actions{grid-template-columns:1fr}}
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

    overlay.querySelector('#al-confirm').addEventListener('click', () => close(true));
    overlay.querySelector('#al-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.al-backdrop').addEventListener('click', () => close(false));
    document.addEventListener('keydown', onKey);

    setTimeout(() => overlay.querySelector('#al-cancel')?.focus(), 30);
  });
}

function renderShell({
  admin,
  activeId,
  menuItems,
  pageTitle,
  pageSubtitle
}) {
  document.body.classList.add('admin-shell-body');

  /* Preserva TODOS os nós da página, não só o contêiner marcado.
     Painéis laterais e modais soltos sobrevivem, e os listeners
     já registrados continuam válidos porque movemos os nós. */
  const preserved = document.createDocumentFragment();

  while (document.body.firstChild) {
    preserved.appendChild(document.body.firstChild);
  }

  document.body.innerHTML = `
    <div class="admin-shell-app">
      <div
        id="admin-shell-backdrop"
        class="admin-shell-backdrop"
      ></div>

      <aside
        id="admin-shell-sidebar"
        class="admin-shell-sidebar"
      >
        <a
          class="admin-shell-brand"
          href="./index.html"
        >
          <span>ECHO</span>
          <strong>ADMIN</strong>
        </a>

        <nav class="admin-shell-nav">
          ${renderMenu(menuItems, activeId)}
        </nav>

        <div class="admin-shell-sidebar-footer">
          <a
            class="admin-shell-site-link"
            href="../index.html"
          >
            Ver site
          </a>
        </div>
      </aside>

      <section class="admin-shell-workspace">
        <header class="admin-shell-topbar">
          <button
            id="admin-shell-mobile-toggle"
            class="admin-shell-mobile-toggle"
            type="button"
            aria-label="Abrir menu"
          >
            ☰
          </button>

          <div class="admin-shell-heading">
            <span data-admin-page-subtitle>
              ${escapeHtml(pageSubtitle ?? '')}
            </span>

            <h1 data-admin-page-title>
              ${escapeHtml(pageTitle ?? 'Painel administrativo')}
            </h1>
          </div>

          <div class="admin-shell-user">
            <div class="admin-shell-user-copy">
              <strong>
                ${escapeHtml(admin.displayName)}
              </strong>

              <span>
                ${escapeHtml(admin.email)}
              </span>
            </div>

            <button
              id="admin-shell-logout"
              class="admin-shell-logout"
              type="button"
            >
              Sair
            </button>
          </div>
        </header>

        <main class="admin-shell-main">
          <div
            id="admin-shell-content"
            data-admin-content
            class="admin-shell-content"
          ></div>
        </main>
      </section>
    </div>
  `;

  document.getElementById('admin-shell-content').appendChild(preserved);

  bindNavigation();
  revealPage();

  document
    .getElementById('admin-shell-logout')
    ?.addEventListener('click', async () => {
      if (!(await confirmAdminLogout())) return;

      await supabase.auth.signOut();
      sessionStorage.removeItem('echoarena_admin_hops');
      location.href = './login.html';
    });
}

export async function initAdminShell({
  activeId = '',
  pageTitle = 'Painel administrativo',
  pageSubtitle = '',
  menuItems = DEFAULT_MENU,
  redirectTo = './login.html'
} = {}) {
  try {
    const admin = await getCurrentAdmin();

    if (!admin) {
      throw new Error(
        'Não foi possível identificar a sessão administrativa.'
      );
    }

    renderShell({
      admin,
      activeId,
      menuItems,
      pageTitle,
      pageSubtitle
    });

    /* Chegou até aqui: sessão validada. Zera o contador de saltos. */
    sessionStorage.removeItem('echoarena_admin_hops');

    return {
      admin,
      setPageTitle,
      supabase
    };
  } catch (error) {
    console.error(
      'Falha ao iniciar o painel:',
      error
    );

    const isCodespacesPreview =
      location.hostname.endsWith('.app.github.dev');

    /*
     * No Codespaces, não redireciona automaticamente.
     * Mostra o erro para conseguirmos corrigir.
     */
    if (isCodespacesPreview) {
      document.body.classList.remove(
        'admin-shell-body'
      );

      document.body.innerHTML = `
        <main
          style="
            max-width: 900px;
            margin: 40px auto;
            padding: 24px;
            font-family: Arial, sans-serif;
            color: #ffffff;
            background: #111a2e;
            border: 1px solid #33415f;
            border-radius: 14px;
          "
        >
          <h1 style="margin-top:0;">
            Falha ao carregar o painel
          </h1>

          <p>
            O Admin Shell encontrou um erro antes de montar a página.
          </p>

          <pre
            style="
              padding:16px;
              overflow:auto;
              white-space:pre-wrap;
              color:#ffb4bd;
              background:#080d18;
              border-radius:10px;
            "
          >${escapeHtml(
            error?.message ||
            String(error)
          )}</pre>

          <p style="color:#aab4c8;">
            Consulte também o Console do navegador para ver os detalhes.
          </p>

          <a
            href="./login.html"
            style="color:#b79cff;"
          >
            Abrir página de login
          </a>
        </main>
      `;

      revealPage();
      return null;
    }

    /* Quebra-loop: no máximo 3 redirecionamentos encadeados. */
    const hops = parseInt(
      sessionStorage.getItem('echoarena_admin_hops') || '0',
      10
    );

    if (hops < 3) {
      sessionStorage.setItem('echoarena_admin_hops', String(hops + 1));
      location.replace(redirectTo);
    } else {
      sessionStorage.removeItem('echoarena_admin_hops');

      document.body.innerHTML = `
        <pre style="padding:2rem;font:14px/1.6 monospace;color:#ffb4bd;background:#0b1221">Loop de autenticacao interrompido.

Motivo: ${escapeHtml(error?.message || String(error))}

Abra o Console (F12) para ver os detalhes.</pre>
      `;
    }

    return null;
  }
}

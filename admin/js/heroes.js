import { listHeroes, deleteHero, setHeroEnabled } from '../../js/api.js';
import { getPublicMediaUrl, removeGameMedia } from '../../js/admin-media.js';

const list =
  document.getElementById('heroes-list');

const search =
  document.getElementById('search');

const statusFilter =
  document.getElementById('status-filter');

const sortFilter =
  document.getElementById('sort-filter');

const message =
  document.getElementById('message');

let heroes = [];
let isLoading = false;
let activeActionId = null;

/* =========================================================
   UTILITÁRIOS
========================================================= */

function setMessage(
  text = '',
  type = ''
) {
  if (!message) {
    return;
  }

  message.textContent = text;

  message.className =
    `heroes-message${type ? ` ${type}` : ''}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function getHeroMediaPath(hero) {
  return (
    hero.card_image_path ||
    hero.image_path ||
    hero.gif_path ||
    ''
  );
}

function getHeroClassName(hero) {
  return (
    hero.class_name ||
    hero.hero_class_name ||
    hero.class?.name ||
    hero.hero_classes?.name ||
    hero.classes?.name ||
    hero.class_id ||
    'Sem classe'
  );
}

/* =========================================================
   FILTROS E ORDENAÇÃO
========================================================= */

function getFilteredHeroes() {
  const query =
    normalizeText(
      search?.value
    );

  const selectedStatus =
    statusFilter?.value ||
    'all';

  const selectedSort =
    sortFilter?.value ||
    'display_order';

  const filtered =
    heroes.filter(hero => {
      const matchesQuery =
        !query ||
        normalizeText(
          hero.name
        ).includes(query) ||
        normalizeText(
          hero.slug
        ).includes(query);

      const matchesStatus =
        selectedStatus === 'all' ||
        (
          selectedStatus === 'active' &&
          hero.enabled !== false
        ) ||
        (
          selectedStatus === 'inactive' &&
          hero.enabled === false
        );

      return (
        matchesQuery &&
        matchesStatus
      );
    });

  filtered.sort((first, second) => {
    if (selectedSort === 'name') {
      return String(
        first.name || ''
      ).localeCompare(
        String(
          second.name || ''
        ),
        'pt-BR'
      );
    }

    if (selectedSort === 'status') {
      const firstEnabled =
        first.enabled !== false
          ? 0
          : 1;

      const secondEnabled =
        second.enabled !== false
          ? 0
          : 1;

      if (
        firstEnabled !==
        secondEnabled
      ) {
        return (
          firstEnabled -
          secondEnabled
        );
      }

      return String(
        first.name || ''
      ).localeCompare(
        String(
          second.name || ''
        ),
        'pt-BR'
      );
    }

    const orderDifference =
      toNumber(
        first.display_order,
        0
      ) -
      toNumber(
        second.display_order,
        0
      );

    if (orderDifference !== 0) {
      return orderDifference;
    }

    return String(
      first.name || ''
    ).localeCompare(
      String(
        second.name || ''
      ),
      'pt-BR'
    );
  });

  return filtered;
}

/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function renderHeroCard(hero) {
  const mediaPath =
    getHeroMediaPath(hero);

  const mediaUrl =
    getPublicMediaUrl(
      mediaPath
    );

  const enabled =
    hero.enabled !== false;

  const isBusy =
    activeActionId === hero.id;

  return `
    <article
      class="hero-card"
      data-hero-id="${escapeHtml(hero.id)}"
    >
      <div class="hero-card-media">
        ${
          mediaUrl
            ? `
              <img
                src="${escapeHtml(mediaUrl)}"
                alt="${escapeHtml(hero.name || '')}"
                loading="lazy"
              >
            `
            : `
              <span class="hero-card-media-empty">
                Sem imagem
              </span>
            `
        }

        <span
          class="hero-card-status ${enabled ? '' : 'is-inactive'}"
        >
          ${enabled ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <div class="hero-card-body">
        <div class="hero-card-heading">
          <h2>
            ${escapeHtml(hero.name || 'Herói sem nome')}
          </h2>

          <p>
            ${escapeHtml(hero.slug || 'sem-identificador')}
          </p>
        </div>

        <div class="hero-card-meta">
          <div class="hero-card-meta-item">
            <span>
              Classe
            </span>

            <strong>
              ${escapeHtml(getHeroClassName(hero))}
            </strong>
          </div>

          <div class="hero-card-meta-item">
            <span>
              Ordem
            </span>

            <strong>
              ${escapeHtml(
                toNumber(
                  hero.display_order,
                  0
                )
              )}
            </strong>
          </div>
        </div>

        <div class="hero-card-actions">
          <a
            class="admin-button"
            href="./hero-editor.html?id=${encodeURIComponent(hero.id)}"
          >
            Editar
          </a>

          <a
            class="admin-button"
            href="./hero-stats.html?hero=${encodeURIComponent(hero.id)}"
          >
            Status
          </a>

          <button
            class="admin-button"
            type="button"
            data-toggle="${escapeHtml(hero.id)}"
            data-enabled="${enabled}"
            ${isBusy ? 'disabled' : ''}
          >
            ${
              isBusy
                ? 'Aguarde...'
                : enabled
                  ? 'Desativar'
                  : 'Ativar'
            }
          </button>

          <button
            class="admin-button danger"
            type="button"
            data-delete="${escapeHtml(hero.id)}"
            ${isBusy ? 'disabled' : ''}
          >
            Excluir
          </button>
        </div>
      </div>
    </article>
  `;
}

function render() {
  const rows =
    getFilteredHeroes();

  if (!rows.length) {
    list.innerHTML = `
      <div class="heroes-empty">
        Nenhum herói encontrado.
      </div>
    `;

    return;
  }

  list.innerHTML =
    rows
      .map(renderHeroCard)
      .join('');

  bindCardActions();
}

/* =========================================================
   AÇÕES
========================================================= */

async function toggleHero(heroId) {
  const hero =
    heroes.find(
      item =>
        String(item.id) ===
        String(heroId)
    );

  if (!hero) {
    return;
  }

  activeActionId =
    hero.id;

  render();

  setMessage(
    hero.enabled !== false
      ? `Desativando ${hero.name}...`
      : `Ativando ${hero.name}...`
  );

  try {
    const newEnabledValue =
      hero.enabled === false;

    await setHeroEnabled(
      hero.id,
      newEnabledValue
    );

    hero.enabled =
      newEnabledValue;

    setMessage(
      newEnabledValue
        ? `${hero.name} foi ativado.`
        : `${hero.name} foi desativado.`,
      'ok'
    );
  } catch (error) {
    console.error(
      'Erro ao alterar herói:',
      error
    );

    setMessage(
      error.message ||
      'Não foi possível alterar o status do herói.',
      'error'
    );
  } finally {
    activeActionId = null;
    render();
  }
}

async function removeHeroMedia(hero) {
  const paths = [
    ...new Set(
      [
        hero.image_path,
        hero.card_image_path,
        hero.gif_path
      ].filter(Boolean)
    )
  ];

  for (const path of paths) {
    try {
      await removeGameMedia(
        path
      );
    } catch (error) {
      console.warn(
        `Não foi possível remover a mídia "${path}":`,
        error
      );
    }
  }
}

async function removeHero(heroId) {
  const hero =
    heroes.find(
      item =>
        String(item.id) ===
        String(heroId)
    );

  if (!hero) {
    return;
  }

  const confirmed =
    window.confirm(
      `Excluir "${hero.name}" permanentemente?\n\n` +
      'Os dados do herói serão removidos. Essa ação não pode ser desfeita.'
    );

  if (!confirmed) {
    return;
  }

  activeActionId =
    hero.id;

  render();

  setMessage(
    `Excluindo ${hero.name}...`
  );

  try {
    /*
     * Primeiro excluímos o registro.
     * As mídias só são removidas depois que
     * a exclusão do banco for confirmada.
     */
    await deleteHero(
      hero.id
    );

    await removeHeroMedia(
      hero
    );

    heroes =
      heroes.filter(
        item =>
          item.id !== hero.id
      );

    setMessage(
      `${hero.name} foi excluído.`,
      'ok'
    );
  } catch (error) {
    console.error(
      'Erro ao excluir herói:',
      error
    );

    setMessage(
      error.message ||
      'Não foi possível excluir o herói.',
      'error'
    );
  } finally {
    activeActionId = null;
    render();
  }
}

function bindCardActions() {
  list
    .querySelectorAll(
      '[data-toggle]'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          toggleHero(
            button.dataset.toggle
          );
        }
      );
    });

  list
    .querySelectorAll(
      '[data-delete]'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          removeHero(
            button.dataset.delete
          );
        }
      );
    });
}

/* =========================================================
   CARREGAMENTO
========================================================= */

async function load() {
  if (isLoading) {
    return;
  }

  isLoading = true;

  list.innerHTML = `
    <div class="heroes-empty">
      Carregando heróis...
    </div>
  `;

  setMessage(
    'Carregando...'
  );

  try {
    heroes =
      await listHeroes();

    setMessage('');

    render();
  } catch (error) {
    console.error(
      'Erro ao carregar heróis:',
      error
    );

    list.innerHTML = `
      <div class="heroes-empty">
        Não foi possível carregar os heróis.
      </div>
    `;

    setMessage(
      error.message ||
      'Não foi possível carregar os heróis.',
      'error'
    );
  } finally {
    isLoading = false;
  }
}

/* =========================================================
   EVENTOS
========================================================= */

search?.addEventListener(
  'input',
  render
);

statusFilter?.addEventListener(
  'change',
  render
);

sortFilter?.addEventListener(
  'change',
  render
);

await load();

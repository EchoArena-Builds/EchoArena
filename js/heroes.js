import { requireAdmin, logoutAdmin } from './admin-auth.js';
import { listHeroes, deleteHero, setHeroEnabled } from './api.js';
import { getPublicMediaUrl, removeGameMedia } from './admin-media.js';

await requireAdmin();

document.getElementById('logout').onclick = logoutAdmin;

const list = document.getElementById('heroes-list');
const search = document.getElementById('search');
const message = document.getElementById('message');
let heroes = [];

function render() {
  const query = search.value.trim().toLowerCase();
  const rows = heroes.filter(hero =>
    !query ||
    hero.name.toLowerCase().includes(query) ||
    hero.slug.toLowerCase().includes(query)
  );

  list.innerHTML = rows.map(hero => {
    const mediaPath = hero.card_image_path || hero.image_path || hero.gif_path;
    const src = getPublicMediaUrl(mediaPath);

    return `
      <article class="hero-card">
        <div class="media">${src ? `<img src="${src}" alt="${hero.name}">` : 'Sem imagem'}</div>
        <div class="body">
          <span class="badge ${hero.enabled ? '' : 'off'}">${hero.enabled ? 'Ativo' : 'Inativo'}</span>
          <h3>${hero.name}</h3>
          <p>${hero.slug}</p>
          <div class="actions">
            <a class="btn" href="./hero-editor.html?id=${hero.id}">Editar</a>
            <button class="btn" data-toggle="${hero.id}" data-enabled="${hero.enabled}">
              ${hero.enabled ? 'Desativar' : 'Ativar'}
            </button>
            <button class="btn danger" data-delete="${hero.id}">Excluir</button>
          </div>
        </div>
      </article>`;
  }).join('') || '<div class="message">Nenhum herói encontrado.</div>';

  list.querySelectorAll('[data-toggle]').forEach(button => {
    button.onclick = async () => {
      try {
        await setHeroEnabled(button.dataset.toggle, button.dataset.enabled !== 'true');
        await load();
      } catch (error) {
        message.textContent = error.message;
        message.className = 'message error';
      }
    };
  });

  list.querySelectorAll('[data-delete]').forEach(button => {
    button.onclick = async () => {
      const hero = heroes.find(item => item.id === button.dataset.delete);
      if (!hero || !confirm(`Excluir ${hero.name}?`)) return;

      try {
        await deleteHero(hero.id);

        const paths = [...new Set([
          hero.image_path,
          hero.card_image_path,
          hero.gif_path
        ].filter(Boolean))];

        for (const path of paths) {
          try { await removeGameMedia(path); } catch (error) { console.warn(error); }
        }

        await load();
      } catch (error) {
        message.textContent = error.message;
        message.className = 'message error';
      }
    };
  });
}

async function load() {
  message.textContent = 'Carregando...';
  message.className = 'message';

  try {
    heroes = await listHeroes();
    message.textContent = '';
    render();
  } catch (error) {
    message.textContent = error.message;
    message.className = 'message error';
  }
}

search.oninput = render;
await load();

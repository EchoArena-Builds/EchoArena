import { supabase } from './supabase.js';
import { resolveMediaUrl } from './media-storage.js';

const pageKey = document.body?.dataset.cmsPage;

function mediaValue(value) {
  if (!value) return null;
  const image = typeof value === 'string' ? { url: value } : value;
  const url = String(image?.url || '').trim();
  if (!/^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(url)) return null;
  return { ...image, url: resolveMediaUrl(url) };
}

function applyMeta(content) {
  if (Object.hasOwn(content, 'meta_title') && content.meta_title) {
    document.title = content.meta_title;
  }

  if (Object.hasOwn(content, 'meta_description') && String(content.meta_description || '').trim()) {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = String(content.meta_description);
  }
}

function applyText(content) {
  document.querySelectorAll('[data-cms-text]').forEach(element => {
    const key = element.dataset.cmsText;
    if (Object.hasOwn(content, key) && content[key] !== null && String(content[key]).trim()) {
      element.textContent = String(content[key]);
    }
  });

  document.querySelectorAll('[data-cms-placeholder]').forEach(element => {
    const key = element.dataset.cmsPlaceholder;
    if (Object.hasOwn(content, key) && content[key] !== null && String(content[key]).trim()) {
      element.placeholder = String(content[key]);
    }
  });

  document.querySelectorAll('[data-cms-link]').forEach(element => {
    const key = element.dataset.cmsLink;
    const value = String(content[key] || '').trim();
    const safe = /^(https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/i.test(value);
    if (Object.hasOwn(content, key) && safe) {
      element.href = value;
    }
  });
}

function applyImages(content) {
  document.querySelectorAll('[data-cms-image]').forEach(element => {
    const fallback = String(element.dataset.cmsFallback || element.getAttribute('src') || '').trim();
    const fallbackUrl = fallback ? resolveMediaUrl(fallback) : '';
    element.onerror = fallbackUrl ? () => {
      element.onerror = null;
      element.src = fallbackUrl;
    } : null;

    const image = mediaValue(content[element.dataset.cmsImage]);
    if (!image) return;
    element.src = image.url;
    if (image.alt !== undefined) element.alt = image.alt;
    if (image.position) element.style.objectPosition = image.position;
    const fit = String(element.dataset.cmsFit || image.fit || '').trim();
    if (fit) element.style.objectFit = fit;
  });

  document.querySelectorAll('[data-cms-bg]').forEach(element => {
    const image = mediaValue(content[element.dataset.cmsBg]);
    if (!image) return;
    element.style.backgroundImage = `linear-gradient(115deg, rgba(5,7,14,.82), rgba(7,8,17,.38)), url("${String(image.url).replaceAll('"', '%22')}")`;
    element.style.backgroundPosition = image.position || '50% 50%';
    const zoom = Math.min(200, Math.max(50, Number(image.zoom || 100)));
    element.style.backgroundSize = zoom === 100 ? (image.fit === 'contain' ? 'contain' : 'cover') : `${zoom}% auto`;
    element.style.backgroundRepeat = 'no-repeat';
  });
}

function applyVisibility(content) {
  document.querySelectorAll('[data-cms-visible]').forEach(element => {
    const key = element.dataset.cmsVisible;
    if (!Object.hasOwn(content, key)) return;
    element.hidden = content[key] === false;
  });
}

function applyImageControls(content) {
  const controls = [
    ['cmsScale', '--cms-image-scale', value => Math.min(140, Math.max(50, value)) / 100],
    ['cmsScaleMobile', '--cms-image-scale-mobile', value => Math.min(130, Math.max(50, value)) / 100],
    ['cmsX', '--cms-image-x', value => `${Math.min(100, Math.max(0, value))}%`],
    ['cmsY', '--cms-image-y', value => `${Math.min(100, Math.max(0, value))}%`]
  ];

  controls.forEach(([datasetKey, property, format]) => {
    document.querySelectorAll(`[data-${datasetKey.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}]`).forEach(element => {
      const key = element.dataset[datasetKey];
      const rawValue = content[key];
      const value = Number(rawValue);
      if (!Object.hasOwn(content, key) || rawValue === null || String(rawValue).trim() === '' || !Number.isFinite(value)) {
        element.style.removeProperty(property);
        return;
      }
      element.style.setProperty(property, String(format(value)));
    });
  });
}

export function applySiteContent(content = {}) {
  window.EchoSiteContent.content = content;
  applyMeta(content);
  applyText(content);
  applyImages(content);
  applyImageControls(content);
  applyVisibility(content);
  document.dispatchEvent(new CustomEvent('echo:content-applied', {
    detail: { pageKey, content }
  }));
}

export async function loadSiteContent() {
  if (!pageKey) return null;

  try {
    const { data, error } = await supabase
      .from('site_pages')
      .select('content,updated_at')
      .eq('page_key', pageKey)
      .eq('published', true)
      .maybeSingle();

    if (error) throw error;
    const content = data?.content && typeof data.content === 'object'
      ? data.content
      : {};
    applySiteContent(content);
    return { content, updatedAt: data?.updated_at || null };
  } catch (error) {
    /* O HTML contém todos os fallbacks. Se o CMS ainda não foi instalado,
       a página continua funcionando normalmente. */
    console.info('[site-content] Conteúdo padrão em uso:', error.message);
    return null;
  }
}

window.EchoSiteContent = { apply: applySiteContent, load: loadSiteContent, content: {} };
loadSiteContent();

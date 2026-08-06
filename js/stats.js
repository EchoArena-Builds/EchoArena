import { supabase } from './supabase.js';

/* =========================================================
   Números reais do site público.
   Substitui os valores fixos que estavam no HTML.
========================================================= */

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function compact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';

  return new Intl.NumberFormat('pt-BR', {
    notation: number >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(number);
}

async function countOf(table, apply = (q) => q) {
  const { count, error } = await apply(
    supabase.from(table).select('id', { count: 'exact', head: true })
  );

  if (error) {
    console.warn(`[stats] contagem de ${table} falhou:`, error.message);
    return null;
  }

  return count ?? 0;
}

/* Builds públicas e não removidas — mesma regra da moderação. */
function publicBuilds(query) {
  return query.eq('is_public', true).is('deleted_at', null);
}

/* =========================================================
   Herói mais usado / uso por herói
========================================================= */

let buildsByHeroCache = null;

async function getBuildsByHero() {
  if (buildsByHeroCache) return buildsByHeroCache;

  const { data, error } = await supabase
    .from('builds')
    .select('hero_id')
    .eq('is_public', true)
    .is('deleted_at', null)
    .limit(2000);

  if (error) {
    console.warn('[stats] uso por herói indisponível:', error.message);
    return null;
  }

  const tally = new Map();

  (data ?? []).forEach(({ hero_id: heroId }) => {
    if (!heroId) return;
    tally.set(heroId, (tally.get(heroId) ?? 0) + 1);
  });

  buildsByHeroCache = { tally, total: data?.length ?? 0 };
  return buildsByHeroCache;
}

async function loadTopHero() {
  const result = await getBuildsByHero();

  if (!result || result.tally.size === 0) {
    setText('stat-top-hero', '—');
    return;
  }

  const [topHeroId] = [...result.tally.entries()]
    .sort((a, b) => b[1] - a[1])[0];

  const { data } = await supabase
    .from('heroes')
    .select('name')
    .eq('id', topHeroId)
    .maybeSingle();

  setText('stat-top-hero', data?.name ?? '—');
}

/* =========================================================
   Barra inferior
========================================================= */

export async function loadSiteStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [heroes, builds, players, today] = await Promise.all([
    countOf('heroes', q => q.eq('enabled', true)),
    countOf('builds', publicBuilds),
    countOf('profiles'),
    countOf('builds', q =>
      publicBuilds(q).gte('created_at', startOfToday.toISOString())
    )
  ]);

  setText('stat-heroes', heroes === null ? '—' : compact(heroes));
  setText('stat-builds', builds === null ? '—' : compact(builds));
  setText('stat-players', players === null ? '—' : compact(players));
  setText('stat-builds-today', today === null ? '—' : compact(today));

  await loadTopHero();
}

/* =========================================================
   Destaques do herói em evidência
========================================================= */

export async function loadHeroHighlights(hero) {
  if (!hero?.id) {
    setText('sp-builds', '—');
    setText('sp-usage', '—');
    setText('sp-class', '—');
    return;
  }

  const result = await getBuildsByHero();

  if (!result) {
    setText('sp-builds', '—');
    setText('sp-usage', '—');
  } else {
    const count = result.tally.get(hero.id) ?? 0;
    const share = result.total > 0 ? (count / result.total) * 100 : 0;

    setText('sp-builds', compact(count));
    setText('sp-usage', result.total > 0 ? `${share.toFixed(1)}%` : '—');
  }

  /* Classe do herói, vinda do cadastro no painel admin. */
  const className =
    hero.class_name ??
    hero.hero_class_name ??
    hero.classes?.name ??
    hero.hero_classes?.name ??
    null;

  setText('sp-class', className ? String(className) : '—');
}

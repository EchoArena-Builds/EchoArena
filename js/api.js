import { supabase } from './supabase.js';

export async function countRows(table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`Erro ao contar ${table}:`, error);
    return 0;
  }

  return count ?? 0;
}

export async function listHeroClasses() {
  const { data, error } = await supabase
    .from('hero_classes')
    .select('id,name,slug,color,icon')
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function listHeroes() {
  const { data, error } = await supabase
    .from('heroes')
    .select(`
      id,
      name,
      slug,
      description,
      enabled,
      display_order,
      class_id,
      image_path,
      card_image_path,
      gif_path,
      image_fit,
      image_position,
      image_scale,
      image_offset_x,
      image_offset_y
    `)
    .order('display_order')
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function getHero(id) {
  const { data, error } = await supabase
    .from('heroes')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function createHero(values) {
  const { data, error } = await supabase
    .from('heroes')
    .insert(values)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateHero(id, values) {
  const { data, error } = await supabase
    .from('heroes')
    .update(values)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteHero(id) {
  const { error } = await supabase
    .from('heroes')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function setHeroEnabled(id, enabled) {
  return updateHero(id, { enabled });
}

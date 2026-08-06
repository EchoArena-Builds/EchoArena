
import { supabase } from '../../js/supabase.js';

const BUCKET = 'game-media';

export function publicMediaUrl(path) {
  if (!path) return '';
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadEquipmentImage(file) {
  if (!file) return null;
  const allowed = ['image/png','image/jpeg','image/webp','image/gif'];
  if (!allowed.includes(file.type)) throw new Error('Use PNG, JPG, WEBP ou GIF.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Imagem maior que 25 MB.');

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const path = `Gears/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    cacheControl: '3600',
    contentType: file.type
  });
  if (error) throw error;
  return path;
}

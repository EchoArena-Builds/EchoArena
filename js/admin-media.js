import { supabase } from './supabase.js';
const BUCKET = 'game-media';
const MAX_SIZE = 25 * 1024 * 1024;
const ALLOWED = ['image/png','image/jpeg','image/gif','image/webp'];

function extensionOf(file) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext || 'bin';
}

function normalizeFolder(folder) {
  return String(folder).replace(/^\/+|\/+$/g, '');
}

export function getPublicMediaUrl(path) {
  if (!path) return '';
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadGameMedia(file, folder) {
  if (!file) return null;
  if (!ALLOWED.includes(file.type)) throw new Error('Formato não permitido.');
  if (file.size > MAX_SIZE) throw new Error('Arquivo maior que 25 MB.');

  const path = `${normalizeFolder(folder)}/${crypto.randomUUID()}.${extensionOf(file)}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false
    });

  if (error) throw error;
  return path;
}

export async function removeGameMedia(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

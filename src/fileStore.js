// File storage for uploaded PDFs and audio mixes, backed by Supabase Storage
// (public bucket "files"). Formerly IndexedDB — same three-function seam.

import { supabase } from './supabase.js'

export async function putFile(id, blob) {
  const { error } = await supabase.storage
    .from('files')
    .upload(id, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' })
  if (error) throw error
  return id
}

export function fileURL(id) {
  if (!id) return null
  return supabase.storage.from('files').getPublicUrl(id).data.publicUrl
}

export async function deleteFile(id) {
  if (!id) return
  try {
    await supabase.storage.from('files').remove([id])
  } catch (e) {
    console.error('deleteFile failed', e)
  }
}

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

// ---- receipts (private bucket) ----
// Receipts can contain names/addresses/card digits, so they live in a private
// bucket. Reads go through short-lived signed URLs, gated by RLS to the
// uploader and editors.

export async function putReceipt(id, blob) {
  const { error } = await supabase.storage
    .from('receipts')
    .upload(id, blob, { upsert: true, contentType: blob.type || 'application/octet-stream' })
  if (error) throw error
  return id
}

export async function receiptURL(id) {
  if (!id) return null
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(id, 600)
  if (error) {
    console.error('receiptURL failed', error)
    return null
  }
  return data.signedUrl
}

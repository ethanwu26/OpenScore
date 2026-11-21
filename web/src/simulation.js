// Import older visitor cards on request without creating or updating a database.
export async function readLegacyCard() {
  if (!globalThis.indexedDB) return null
  const db = await new Promise((resolve,reject) => {
    const req = indexedDB.open('openscore-audience-v1')
    let missing = false
    req.onupgradeneeded = () => { missing = true; req.transaction.abort() }
    req.onerror = () => missing ? resolve(null) : reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
  if (!db) return null
  try {
    if (!db.objectStoreNames.contains('cards')) return null
    return await new Promise((resolve,reject) => {
      const req = db.transaction('cards').objectStore('cards').get('my-card')
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}

// SnapRec — estadísticas locales (IndexedDB)
// Cada grabación guarda metadatos: timestamp, duración, tamaño, resolución, codec, modo, calidad, cámara
// Expone window.Stats

const Stats = (() => {
  const DB_NAME = 'snaprec-stats'
  const DB_VERSION = 1
  const STORE = 'recordings'

  let db = null

  function openDB () {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db)
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const d = e.target.result
        if (!d.objectStoreNames.contains(STORE)) {
          const store = d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }
      }
      req.onsuccess = (e) => { db = e.target.result; resolve(db) }
      req.onerror = () => reject(req.error)
    })
  }

  // ── Guardar metadatos de una grabación ──

  async function save (data) {
    const d = await openDB()
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).add({
        timestamp: data.timestamp || Date.now(),
        duration: data.duration || 0,         // segundos
        size: data.size || 0,                 // bytes
        width: data.width || 0,
        height: data.height || 0,
        codec: data.codec || '',
        mode: data.mode || 'full',
        quality: data.quality || 'native24',
        camera: data.camera || 'off',
        name: data.name || ''
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  // ── Consultar grabaciones con filtro de fechas ──
  // period: { since, until } timestamps en ms, o null para todo

  async function query (period = null) {
    const d = await openDB()
    return new Promise((resolve, reject) => {
      const all = []
      const tx = d.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const index = store.index('timestamp')
      let cursorReq

      if (period) {
        const range = IDBKeyRange.bound(period.since, period.until, false, false)
        cursorReq = index.openCursor(range)
      } else {
        cursorReq = index.openCursor()
      }

      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor) { all.push(cursor.value); cursor.continue() }
        else resolve(all)
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  }

  // ── Últimas N grabaciones (más recientes primero) ──

  async function latest (limit = 20) {
    const d = await openDB()
    return new Promise((resolve, reject) => {
      const all = []
      const tx = d.transaction(STORE, 'readonly')
      const index = tx.objectStore(STORE).index('timestamp')
      const cursorReq = index.openCursor(null, 'prev')  // descendente
      let count = 0
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor && count < limit) { all.push(cursor.value); count++; cursor.continue() }
        else resolve(all)
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  }

  // ── Resumen para un período ──

  async function summary (period = null) {
    const rows = await query(period)
    const total = rows.length
    let totalSize = 0
    let totalDuration = 0
    for (const r of rows) {
      totalSize += r.size || 0
      totalDuration += r.duration || 0
    }
    return { total, totalSize, totalDuration, avgDuration: total ? Math.round(totalDuration / total) : 0 }
  }

  // ── Agrupar grabaciones por día para la gráfica ──

  async function byDay (period) {
    const rows = await query(period)
    const map = {}
    for (const r of rows) {
      const day = new Date(r.timestamp).toISOString().slice(0, 10)  // YYYY-MM-DD
      if (!map[day]) map[day] = { count: 0, totalSize: 0, totalDuration: 0 }
      map[day].count++
      map[day].totalSize += r.size || 0
      map[day].totalDuration += r.duration || 0
    }
    return map
  }

  // ── Obtener rango completo de fechas ──

  async function getAll () {
    return query(null)
  }

  return { save, query, latest, summary, byDay, getAll }
})()

// Inicializar DB al cargar
Stats.getAll().catch(() => {})

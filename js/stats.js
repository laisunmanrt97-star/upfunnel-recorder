// SnapRec — estadísticas locales (IndexedDB)
// Cada grabación guarda metadatos: timestamp, duración, tamaño, resolución, codec, modo, calidad, cámara
// Expone window.Stats

const Stats = (() => {
  const DB_NAME = 'snaprec-stats'
  const DB_VERSION = 1
  const STORE = 'recordings'
  const PREF_KEY = 'snaprec-stats-prefs'
  const VALID_RETENTION = new Set(['30', '90', '365', 'forever'])

  let db = null
  let writeQueue = Promise.resolve()

  function getPreferences () {
    try {
      const stored = JSON.parse(localStorage.getItem(PREF_KEY)) || {}
      return {
        enabled: stored.enabled !== false,
        retention: VALID_RETENTION.has(stored.retention) ? stored.retention : 'forever'
      }
    } catch {
      return { enabled: true, retention: 'forever' }
    }
  }

  function savePreferences (preferences) {
    localStorage.setItem(PREF_KEY, JSON.stringify(preferences))
  }

  function enqueueWrite (operation) {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.catch(() => {})
    return result
  }

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

  function runTransaction (mode, operation) {
    return openDB().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode)
      operation(tx.objectStore(STORE), resolve, reject)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }))
  }

  function pruneForPreferences (preferences, now = Date.now()) {
    if (preferences.retention === 'forever') return Promise.resolve()
    const cutoff = now - Number(preferences.retention) * 86_400_000
    return runTransaction('readwrite', (store, resolve, reject) => {
      const cursorReq = store.index('timestamp').openCursor(IDBKeyRange.upperBound(cutoff, true))
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result
        if (!cursor) return
        cursor.delete()
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  }

  function setEnabled (enabled) {
    const preferences = getPreferences()
    preferences.enabled = Boolean(enabled)
    savePreferences(preferences)
    return preferences
  }

  async function setRetention (retention) {
    if (!VALID_RETENTION.has(retention)) throw new TypeError('Retención no válida')
    const preferences = getPreferences()
    preferences.retention = retention
    savePreferences(preferences)
    await pruneExpired()
    return preferences
  }

  function pruneExpired (now = Date.now()) {
    return enqueueWrite(() => pruneForPreferences(getPreferences(), now))
  }

  async function save (data) {
    const preferences = getPreferences()
    if (!preferences.enabled) return
    return enqueueWrite(async () => {
      await pruneForPreferences(preferences)
      await runTransaction('readwrite', (store) => {
        store.add({
          timestamp: data.timestamp || Date.now(),
          duration: data.duration || 0,
          size: data.size || 0,
          width: data.width || 0,
          height: data.height || 0,
          codec: data.codec || '',
          mode: data.mode || 'full',
          quality: data.quality || 'native24',
          camera: data.camera || 'off',
          name: data.name || '',
          title: data.title || data.name || ''
        })
      })
    })
  }

  function remove (id) {
    if (!Number.isFinite(Number(id))) return Promise.reject(new TypeError('ID no válido'))
    return enqueueWrite(() => runTransaction('readwrite', (store) => store.delete(Number(id))))
  }

  function clear () {
    return enqueueWrite(() => runTransaction('readwrite', (store) => store.clear()))
  }

  async function waitForWrites () {
    await writeQueue
  }

  // ── Consultar grabaciones con filtro de fechas ──
  // period: { since, until } timestamps en ms, o null para todo

  async function query (period = null) {
    await waitForWrites()
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
    await waitForWrites()
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
      const day = new Date(r.timestamp).toLocaleDateString('en-CA')  // YYYY-MM-DD en zona local
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

  return {
    save, query, latest, summary, byDay, getAll,
    getPreferences, setEnabled, setRetention, pruneExpired, remove, clear
  }
})()

Stats.pruneExpired().catch(() => {})

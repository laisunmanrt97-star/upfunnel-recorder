// SnapRec — captura de pantalla + mezcla de audio + MediaRecorder
// Grabacion normal en memoria, con soporte opcional para streaming a disco.
// Expone window.Recorder

const Recorder = (() => {
  const MAX_MEMORY_DURATION_MS = 30 * 60 * 1000
  const MAX_VIDEO_BITS_PER_SECOND = 4_000_000
  const PRESETS = {
    native24: { frameRate: 24, videoBitsPerSecond: 2_500_000, height: null },
    light15:  { frameRate: 15, videoBitsPerSecond: 1_200_000, height: null },
    hd720:    { frameRate: 24, videoBitsPerSecond: 2_000_000, height: 720 }
  }

  let mediaRecorder = null
  let displayStream = null
  let micStream     = null
  let camStream     = null      // cámara incrustada en el video
  let mixCtx        = null
  let cropStop      = null      // detiene el pipeline por canvas
  let studio        = null      // { stream, annotationCanvas, width, height } para la UI

  let fileHandle    = null      // File System Access
  let writable      = null
  let chunks        = []        // fallback en memoria
  let bytesWritten  = 0

  let timerInterval = null
  let elapsedMs     = 0
  let lastTick      = 0

  let onStopCallback = null
  let sessionTitle = ''
  let sessionMimeType = ''
  let finalizing = false
  let stopRequested = false

  function setTitle (t) { sessionTitle = t.trim() }
  function getTitle () { return sessionTitle }

  function pickMimeType () {
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.42001E,mp4a.40.2',
      'video/mp4'
    ]
    const mime = candidates.find(c => MediaRecorder.isTypeSupported(c))
    if (!mime) {
      throw new DOMException('Este navegador no ofrece grabacion MP4 con H.264/AAC.', 'NotSupportedError')
    }
    return mime
  }

  function suggestedName (mime = sessionMimeType || pickMimeType()) {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
    const ext = '.mp4'
    if (sessionTitle) {
      const safe = sessionTitle.replace(/[^a-zA-Z0-9áéíóúñ\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
      return `snaprec-${safe}-${ts}${ext}`
    }
    return `snaprec-${ts}${ext}`
  }

  // Debe llamarse DENTRO del gesto de usuario (click en GRABAR), antes de
  // cualquier await largo, para que showSaveFilePicker no pierda la activación.
  async function pickSaveTarget () {
    fileHandle = null
    if (!window.showSaveFilePicker) return 'memory'
    const mime = pickMimeType()
    const ext = '.mp4'
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName(mime),
        types: [{ description: 'Video MP4', accept: { 'video/mp4': [ext] } }]
      })
      return 'disk'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
      console.warn('[SnapRec] showSaveFilePicker falló, usando memoria:', err)
      return 'memory'
    }
  }

  // ── Iniciar grabación ─────────────────────────────────────────────────────
  // mode: 'full' | 'area'   quality: clave de PRESETS
  // camera: null | { shape, size, corner } → se incrusta limpia en el video
  async function start ({ mode, quality, camera, onStop }) {
    finalizing = false
    stopRequested = false
    onStopCallback = onStop
    const preset = PRESETS[quality] || PRESETS.native24

    const videoConstraints = { frameRate: { ideal: preset.frameRate, max: preset.frameRate } }
    if (preset.height) videoConstraints.height = { ideal: preset.height }

    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: true   // audio del sistema, si el usuario marca "compartir audio"
    })

    // El botón nativo "Dejar de compartir" de Chrome detiene la grabación
    displayStream.getVideoTracks()[0].addEventListener('ended', () => {
      // Forzar foco a SnapRec: Chrome no concede window.focus() desde un evento
      // ended, así que usamos un intento múltiple + cambio de título para avisar
      document.title = '⏹ SnapRec — grabación finalizada'
      setTimeout(() => { document.title = 'SnapRec' }, 4000)
      // Intentar recuperar el foco varias veces
      function tryFocus () {
        try { window.focus() } catch {}
      }
      tryFocus()
      setTimeout(tryFocus, 100)
      setTimeout(tryFocus, 300)
      setTimeout(tryFocus, 600)
      window.addEventListener('focus', function onFocus () {
        document.title = 'SnapRec'
        window.removeEventListener('focus', onFocus)
      })
      stop()
    })

    // Modo área: el usuario selecciona un rectángulo sobre un frame congelado
    let region = null
    if (mode === 'area') {
      region = await Crop.selectArea(displayStream)
      if (!region) {
        cleanupStreams()
        onStopCallback = null
        return false
      }
    }

    // Cámara incrustada (círculo/rectángulo limpio dibujado dentro del video)
    if (camera) {
      try { camStream = await Devices.getCamStream() }
      catch (err) { console.warn('[SnapRec] Sin cámara, se graba sin ella:', err.name); camStream = null }
    }
    if (stopRequested) {
      cleanupStreams()
      onStopCallback = null
      return false
    }

    const targetHeight = preset.height || undefined

    // Todas las grabaciones pasan por el compositor para que las anotaciones
    // esten disponibles independientemente del modo o del uso de camara.
    const piped = await Crop.createPipeline({
      displayStream, region, camStream, camera, withAnnotations: true, fps: preset.frameRate, targetHeight
    })
    const videoTrackStream = piped.stream
    cropStop = piped.stop
    studio = {
      stream: piped.stream,
      annotationCanvas: piped.annotationCanvas,
      width: piped.width,
      height: piped.height,
      setAnnotationsEnabled: piped.setAnnotationsEnabled,
      setCameraOnly: piped.setCameraOnly,
      getCameraRect: piped.getCameraRect,
      setCameraPosition: piped.setCameraPosition
    }
    if (stopRequested) {
      cleanupStreams()
      onStopCallback = null
      return false
    }

    // ── Mezcla de audio: mic opcional + audio del sistema (si existe) ──
    try {
      micStream = await Devices.getMicStream()
    } catch (err) {
      console.warn('[SnapRec] Sin microfono, se graba sin el:', err.name)
      micStream = null
    }

    let mixedAudioTracks = []
    const systemAudioTracks = displayStream.getAudioTracks()
    if (micStream || systemAudioTracks.length > 0) {
      mixCtx = new AudioContext()
      const dest = mixCtx.createMediaStreamDestination()
      if (micStream) mixCtx.createMediaStreamSource(micStream).connect(dest)
      if (systemAudioTracks.length > 0) {
        mixCtx.createMediaStreamSource(new MediaStream(systemAudioTracks)).connect(dest)
      }
      mixedAudioTracks = dest.stream.getAudioTracks()
    }
    if (stopRequested) {
      cleanupStreams()
      onStopCallback = null
      return false
    }

    const recStream = new MediaStream([
      videoTrackStream.getVideoTracks()[0],
      ...mixedAudioTracks
    ])

    // ── Destino de guardado ──
    chunks = []
    bytesWritten = 0
    writable = null
    if (fileHandle) {
      try { writable = await fileHandle.createWritable() }
      catch (err) { console.warn('[SnapRec] No se pudo escribir a disco, usando memoria:', err); fileHandle = null }
    }

    // Bitrate dinámico: escalar el preset según píxeles reales de salida
    // (referencia 720p = 1280×720 = 921 600 px)
    const refPixels = 1280 * 720
    const outPixels = (studio.width || 1) * (studio.height || 1)
    const scale = Math.max(0.5, outPixels / refPixels)
    const dynamicVideoBits = Math.min(MAX_VIDEO_BITS_PER_SECOND, Math.round(preset.videoBitsPerSecond * scale))

    const mimeType = pickMimeType()
    sessionMimeType = mimeType
    mediaRecorder = new MediaRecorder(recStream, {
      mimeType,
      videoBitsPerSecond: dynamicVideoBits,
      audioBitsPerSecond: 128_000
    })

    mediaRecorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return
      bytesWritten += e.data.size
      if (writable) {
        try { await writable.write(e.data) }
        catch (err) { console.error('[SnapRec] Error escribiendo a disco:', err); chunks.push(e.data); writable = null }
      } else {
        chunks.push(e.data)
      }
    }

    mediaRecorder.onstop = finalize

    // En memoria, dejar que Chromium cierre un MP4 autocontenido al detener.
    // Los fragmentos periodicos solo son necesarios para escritura directa.
    if (writable) mediaRecorder.start(1000)
    else mediaRecorder.start()
    startTimer()
    return true
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  function startTimer () {
    elapsedMs = 0
    lastTick = performance.now()
    timerInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        const now = performance.now()
        elapsedMs += now - lastTick
        lastTick = now
        updateTimerDisplay()
        if (!writable && elapsedMs >= MAX_MEMORY_DURATION_MS) {
          alert('La grabación alcanzó el límite de 30 minutos en memoria y se detendrá para proteger el navegador.')
          stop()
        }
      } else {
        lastTick = performance.now()
      }
    }, 250)
  }

  function updateTimerDisplay () {
    const s = Math.floor(elapsedMs / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    const el = document.getElementById('rec-timer')
    if (el) el.textContent = `${mm}:${ss}`
  }

  // ── Pausa / stop ──────────────────────────────────────────────────────────

  function togglePause () {
    if (!mediaRecorder) return 'inactive'
    if (mediaRecorder.state === 'recording') { mediaRecorder.pause(); return 'paused' }
    if (mediaRecorder.state === 'paused') { lastTick = performance.now(); mediaRecorder.resume(); return 'recording' }
    return mediaRecorder.state
  }

  function stop () {
    if (stopRequested || finalizing) return
    stopRequested = true
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    } else if (!mediaRecorder) {
      cleanupStreams()
      onStopCallback = null
    }
  }

  async function finalize () {
    if (finalizing) return
    finalizing = true
    clearInterval(timerInterval)
    const info = getInfo()
    cleanupStreams()

    let result
    if (writable) {
      try { await writable.close() } catch (err) { console.error('[SnapRec] Error cerrando archivo:', err) }
      result = { saved: 'disk', name: fileHandle.name, bytes: bytesWritten, handle: fileHandle, info }
    } else {
      const mime = mediaRecorder?.mimeType || sessionMimeType
      const blob = new Blob(chunks, { type: mime })
      result = { saved: 'memory', name: suggestedName(mime), bytes: blob.size, blob, info }
    }

    writable = null
    fileHandle = null
    sessionMimeType = ''
    chunks = []
    mediaRecorder = null

    const callback = onStopCallback
    onStopCallback = null
    if (callback) callback(result)
  }

  function abort () {
    clearInterval(timerInterval)
    onStopCallback = null
    finalizing = true
    stopRequested = true
    if (mediaRecorder) {
      mediaRecorder.onstop = null
      mediaRecorder.ondataavailable = null
      try {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
      } catch {}
    }
    if (writable) writable.abort().catch(() => {})
    writable = null
    fileHandle = null
    sessionMimeType = ''
    chunks = []
    mediaRecorder = null
    cleanupStreams()
  }

  function cleanupStreams () {
    studio = null
    if (cropStop) { cropStop(); cropStop = null }
    if (displayStream) { displayStream.getTracks().forEach(t => t.stop()); displayStream = null }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null }
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null }
    if (mixCtx) { mixCtx.close().catch(() => {}); mixCtx = null }
  }

  function isRecording () {
    return mediaRecorder !== null && mediaRecorder.state !== 'inactive'
  }

  function getInfo () {
    return {
      width: studio?.width || 0,
      height: studio?.height || 0,
      codec: mediaRecorder?.mimeType || '',
      bytes: bytesWritten,
      duration: Math.round(elapsedMs / 1000)
    }
  }

  return { pickSaveTarget, start, togglePause, stop, abort, isRecording, getStudio: () => studio, getInfo, getCameraStream: () => camStream, setTitle, getTitle }
})()

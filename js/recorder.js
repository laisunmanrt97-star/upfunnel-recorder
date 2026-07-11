// SnapRec — captura de pantalla + mezcla de audio + MediaRecorder
// Guardado en streaming a disco (File System Access API) para no acumular RAM;
// fallback a Blob en memoria si el navegador no lo soporta.
// Expone window.Recorder

const Recorder = (() => {
  const PRESETS = {
    native24: { frameRate: 24, videoBitsPerSecond: 2_500_000, height: null },
    light15:  { frameRate: 15, videoBitsPerSecond: 1_200_000, height: null },
    hd720:    { frameRate: 24, videoBitsPerSecond: 2_000_000, height: 720 }
  }

  let mediaRecorder = null
  let displayStream = null
  let micStream     = null
  let mixCtx        = null
  let cropStop      = null      // función para detener el pipeline de recorte (modo área)

  let fileHandle    = null      // File System Access
  let writable      = null
  let chunks        = []        // fallback en memoria
  let bytesWritten  = 0

  let timerInterval = null
  let elapsedMs     = 0
  let lastTick      = 0

  let onStopCallback = null

  function pickMimeType () {
    const candidates = [
      'video/webm;codecs=h264,opus',   // hardware encode si está disponible
      'video/webm;codecs=vp8,opus',    // el más liviano por software
      'video/webm'
    ]
    return candidates.find(c => MediaRecorder.isTypeSupported(c)) || ''
  }

  function suggestedName () {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `snaprec-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.webm`
  }

  // Debe llamarse DENTRO del gesto de usuario (click en GRABAR), antes de
  // cualquier await largo, para que showSaveFilePicker no pierda la activación.
  async function pickSaveTarget () {
    fileHandle = null
    if (!window.showSaveFilePicker) return 'memory'
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName(),
        types: [{ description: 'Video WebM', accept: { 'video/webm': ['.webm'] } }]
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
  async function start ({ mode, quality, onStop }) {
    onStopCallback = onStop
    const preset = PRESETS[quality] || PRESETS.native24

    const videoConstraints = { frameRate: { ideal: preset.frameRate, max: preset.frameRate } }
    if (preset.height) videoConstraints.height = { ideal: preset.height }

    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: true   // audio del sistema, si el usuario marca "compartir audio"
    })

    // El botón nativo "Dejar de compartir" de Chrome detiene la grabación
    displayStream.getVideoTracks()[0].addEventListener('ended', () => stop())

    // Modo área: el usuario selecciona un rectángulo sobre un frame congelado
    let videoTrackStream = displayStream
    if (mode === 'area') {
      const cropped = await Crop.selectAndCrop(displayStream, preset.frameRate)
      if (!cropped) { cleanupStreams(); return false }  // canceló con ESC
      videoTrackStream = cropped.stream
      cropStop = cropped.stop
    }

    // ── Mezcla de audio: mic (siempre) + audio del sistema (si existe) ──
    micStream = await Devices.getMicStream()
    mixCtx = new AudioContext()
    const dest = mixCtx.createMediaStreamDestination()
    mixCtx.createMediaStreamSource(micStream).connect(dest)
    if (displayStream.getAudioTracks().length > 0) {
      mixCtx.createMediaStreamSource(new MediaStream(displayStream.getAudioTracks())).connect(dest)
    }

    const recStream = new MediaStream([
      videoTrackStream.getVideoTracks()[0],
      ...dest.stream.getAudioTracks()
    ])

    // ── Destino de guardado ──
    chunks = []
    bytesWritten = 0
    writable = null
    if (fileHandle) {
      try { writable = await fileHandle.createWritable() }
      catch (err) { console.warn('[SnapRec] No se pudo escribir a disco, usando memoria:', err); fileHandle = null }
    }

    const mimeType = pickMimeType()
    mediaRecorder = new MediaRecorder(recStream, {
      mimeType,
      videoBitsPerSecond: preset.videoBitsPerSecond,
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

    mediaRecorder.start(1000)   // un chunk por segundo → RAM plana si se escribe a disco
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
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
    else finalize()
  }

  async function finalize () {
    clearInterval(timerInterval)
    cleanupStreams()

    let result
    if (writable) {
      try { await writable.close() } catch (err) { console.error('[SnapRec] Error cerrando archivo:', err) }
      result = { saved: 'disk', name: fileHandle.name, bytes: bytesWritten, handle: fileHandle }
    } else {
      const blob = new Blob(chunks, { type: 'video/webm' })
      result = { saved: 'memory', name: suggestedName(), bytes: blob.size, blob }
    }

    writable = null
    fileHandle = null
    chunks = []
    mediaRecorder = null

    if (onStopCallback) onStopCallback(result)
  }

  function cleanupStreams () {
    if (cropStop) { cropStop(); cropStop = null }
    if (displayStream) { displayStream.getTracks().forEach(t => t.stop()); displayStream = null }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null }
    if (mixCtx) { mixCtx.close().catch(() => {}); mixCtx = null }
  }

  function isRecording () {
    return mediaRecorder !== null && mediaRecorder.state !== 'inactive'
  }

  return { pickSaveTarget, start, togglePause, stop, isRecording }
})()

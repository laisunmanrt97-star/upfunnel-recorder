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

  function setTitle (t) { sessionTitle = t.trim() }
  function getTitle () { return sessionTitle }

  function pickMimeType () {
    const candidates = [
      'video/mp4;codecs=h264,aac',       // MP4 nativo (Chrome 97+) — ideal
      'video/mp4',                         // MP4 genérico
      'video/webm;codecs=h264,opus',       // WebM con H.264 (fallback)
      'video/webm;codecs=vp8,opus',        // fallback VP8
      'video/webm'
    ]
    return candidates.find(c => MediaRecorder.isTypeSupported(c)) || ''
  }

  function mimeExt (mime) {
    return mime.startsWith('video/mp4') ? '.mp4' : '.webm'
  }

  function suggestedName () {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
    const ext = mimeExt(pickMimeType())
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
    const ext = mimeExt(pickMimeType())
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName(),
        types: [{ description: `Video ${ext.slice(1).toUpperCase()}`, accept: { [`video/${ext.slice(1)}`]: [ext] } }]
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
      if (!region) { cleanupStreams(); return false }  // canceló con ESC
    }

    // Cámara incrustada (círculo/rectángulo limpio dibujado dentro del video)
    if (camera) {
      try { camStream = await Devices.getCamStream() }
      catch (err) { console.warn('[SnapRec] Sin cámara, se graba sin ella:', err.name); camStream = null }
    }

    // Bypass de canvas cuando no hay recorte, cámara ni anotaciones —
    // el track nativo de getDisplayMedia va directo al encoder, 0 CPU extra.
    const needsCanvas = !!(region || camera)
    const targetHeight = preset.height || undefined

    let videoTrackStream
    if (needsCanvas) {
      const piped = await Crop.createPipeline({
        displayStream, region, camStream, camera, withAnnotations: true, fps: preset.frameRate, targetHeight
      })
      videoTrackStream = piped.stream
      cropStop = piped.stop
      studio = {
        stream: piped.stream,
        annotationCanvas: piped.annotationCanvas,
        width: piped.width,
        height: piped.height,
        setAnnotationsEnabled: piped.setAnnotationsEnabled,
        setCameraOnly: piped.setCameraOnly
      }
    } else {
      const rawTrack = displayStream.getVideoTracks()[0]
      videoTrackStream = new MediaStream([rawTrack])
      cropStop = () => {}
      const s = rawTrack.getSettings() || {}
      studio = {
        stream: videoTrackStream,
        annotationCanvas: null,
        width: s.width || 0,
        height: s.height || 0
      }
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

    // Bitrate dinámico: escalar el preset según píxeles reales de salida
    // (referencia 720p = 1280×720 = 921 600 px)
    const refPixels = 1280 * 720
    const outPixels = (studio.width || 1) * (studio.height || 1)
    const scale = Math.max(0.5, outPixels / refPixels)
    const dynamicVideoBits = Math.round(preset.videoBitsPerSecond * scale)

    const mimeType = pickMimeType()
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
      const mime = mediaRecorder?.mimeType || 'video/mp4'
      const blob = new Blob(chunks, { type: mime })
      result = { saved: 'memory', name: suggestedName(), bytes: blob.size, blob }
    }

    writable = null
    fileHandle = null
    chunks = []
    mediaRecorder = null

    if (onStopCallback) onStopCallback(result)
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

  return { pickSaveTarget, start, togglePause, stop, isRecording, getStudio: () => studio, getInfo, getCameraStream: () => camStream, setTitle, getTitle }
})()

// SnapRec — modo CAPTURA: screenshot de pantalla/ventana + editor de anotaciones
// El stream de pantalla queda vivo entre capturas (solo se pide permiso una vez).
// Expone window.Capture

const Capture = (() => {
  const MAX_EDIT_PIXELS = 8_000_000
  const canvas = document.getElementById('edit-canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  let captureStream = null
  let surface = null       // API de Tools.attach para el editor
  let toolbar = null       // estado del toolbar (lo inyecta app.js en init)

  function init (toolbarState) { toolbar = toolbarState }

  async function ensureStream () {
    const track = captureStream && captureStream.getVideoTracks()[0]
    if (track && track.readyState === 'live') return
    captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    captureStream.getVideoTracks()[0].addEventListener('ended', () => { captureStream = null })
  }

  function stopStream () {
    if (captureStream) { captureStream.getTracks().forEach(t => t.stop()); captureStream = null }
  }

  // Aviso sonoro: la captura se tomó, puedes volver a la pestaña
  function beep () {
    try {
      const ac = new AudioContext()
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.15, ac.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35)
      osc.connect(gain).connect(ac.destination)
      osc.start()
      osc.stop(ac.currentTime + 0.35)
      osc.onended = () => ac.close()
    } catch {}
  }

  // ── Tomar captura ──────────────────────────────────────────────────────────
  // mode: 'full' | 'area' — devuelve true si el editor quedó montado

  async function take (mode) {
    await ensureStream()

    // Cuenta regresiva para que el usuario cambie a la app que quiere capturar
    await Tools.countdown(3, 'Cambia a la app que quieres capturar')

    const frame = await Crop.freezeFrame(captureStream)
    beep()
    document.title = '✅ SnapRec — captura lista'
    setTimeout(() => { document.title = 'SnapRec' }, 4000)

    let region = null
    if (mode === 'area') {
      region = await Crop.selectOnFrame(frame)
      if (!region) return false   // canceló con ESC
    }

    // Montar el frame (o el recorte) en el canvas del editor
    const sourceWidth = region ? region.w : frame.width
    const sourceHeight = region ? region.h : frame.height
    const scale = Math.min(1, Math.sqrt(MAX_EDIT_PIXELS / (sourceWidth * sourceHeight)))
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    if (region) {
      ctx.drawImage(frame, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height)
    } else {
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
    }
    updateDims()

    // (Re)conectar la superficie de dibujo
    if (surface) surface.destroy()
    surface = Tools.attach(canvas, {
      getTool:  () => toolbar.tool,
      getColor: () => toolbar.color,
      getSize:  () => toolbar.size,
      onText: (x, y) => {
        Tools.textInput({
          canvas,
          x, y,
          color: toolbar.color,
          size: toolbar.size,
          onCommit: (text) => surface.commitText(text, x, y, toolbar.color, toolbar.size)
        })
      },
      onCrop: (r) => {
        const data = ctx.getImageData(r.x, r.y, r.w, r.h)
        canvas.width = r.w
        canvas.height = r.h
        ctx.putImageData(data, 0, 0)
        updateDims()
        surface.resetHistory()
        surface.syncOverlaySize()
      }
    })
    toolbar.api = surface
    return true
  }

  function updateDims () {
    document.getElementById('edit-dims').textContent = `${canvas.width} × ${canvas.height} px`
  }

  // ── Exportar ───────────────────────────────────────────────────────────────

  function fileName () {
    const d = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `snapcap-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`
  }

  async function copyToClipboard () {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  async function download () {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName()
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  function hasLiveStream () {
    return captureStream !== null && captureStream.getVideoTracks()[0]?.readyState === 'live'
  }

  function teardown () {
    if (surface) { surface.destroy(); surface = null }
  }

  return { init, take, copyToClipboard, download, stopStream, hasLiveStream, teardown }
})()

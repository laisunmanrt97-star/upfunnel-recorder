// SnapRec — burbuja flotante de cámara (Document Picture-in-Picture)
// La ventana PiP es siempre-visible: queda grabada dentro de la captura de pantalla.
// Expone window.Bubble

const Bubble = (() => {
  const btnBubble = document.getElementById('btn-bubble')

  let pipWindow = null
  let camStream = null
  let shape = 'circle'   // circle | rect
  let size  = 'm'        // s | m | l

  const SIZES = {
    circle: { s: [140, 140], m: [200, 200], l: [280, 280] },
    rect:   { s: [200, 150], m: [280, 210], l: [380, 285] }
  }

  const PREF_KEY = 'snaprec-bubble'

  function loadPrefs () {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY)) || {}
      if (p.shape) shape = p.shape
      if (p.size)  size  = p.size
    } catch {}
  }
  function savePrefs () {
    localStorage.setItem(PREF_KEY, JSON.stringify({ shape, size }))
  }

  function isSupported () {
    return 'documentPictureInPicture' in window
  }

  function isOpen () {
    return pipWindow !== null
  }

  // ── Abrir / cerrar ────────────────────────────────────────────────────────

  async function open () {
    if (pipWindow) return
    try {
      camStream = await Devices.getCamStream()
    } catch (err) {
      alert('No se pudo abrir la cámara: ' + err.name)
      return
    }

    const [w, h] = SIZES[shape][size]

    if (isSupported()) {
      pipWindow = await documentPictureInPicture.requestWindow({ width: w, height: h })
    } else {
      // Fallback: popup normal (no queda siempre-visible)
      pipWindow = window.open('', 'snaprec-bubble', `width=${w},height=${h},popup=yes`)
      if (!pipWindow) {
        alert('El navegador bloqueó la ventana de la cámara. Usa Chrome/Edge actualizado.')
        stopCam()
        return
      }
    }

    const doc = pipWindow.document
    doc.body.style.cssText = 'margin:0;background:#080C14;overflow:hidden;display:flex;align-items:center;justify-content:center;height:100vh;'
    const video = doc.createElement('video')
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.srcObject = camStream
    applyShape(video)
    doc.body.appendChild(video)

    pipWindow.addEventListener('pagehide', () => {
      pipWindow = null
      stopCam()
      updateButton()
    })

    updateButton()
  }

  function applyShape (video) {
    const doc = pipWindow.document
    const vw = doc.defaultView.innerWidth
    const vh = doc.defaultView.innerHeight
    const side = Math.min(vw, vh)
    if (shape === 'circle') {
      video.style.cssText = `width:${side}px;height:${side}px;object-fit:cover;border-radius:50%;border:2px solid #00E5FF;box-sizing:border-box;`
    } else {
      video.style.cssText = `width:${vw}px;height:${vh}px;object-fit:cover;border-radius:8px;border:2px solid #00E5FF;box-sizing:border-box;`
    }
  }

  function close () {
    if (pipWindow) { pipWindow.close(); pipWindow = null }
    stopCam()
    updateButton()
  }

  function stopCam () {
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null }
  }

  async function toggle () {
    if (pipWindow) close()
    else await open()
  }

  function updateButton () {
    btnBubble.textContent = `VISTA PREVIA: ${pipWindow ? 'ON' : 'OFF'}`
    btnBubble.classList.toggle('active', !!pipWindow)
  }

  // Si cambia la cámara con la burbuja abierta, reabrirla con la nueva
  async function onCameraChange () {
    if (pipWindow) { close(); await open() }
  }

  // Cambiar forma/tamaño (reabre si está activa)
  async function setShape (s) {
    shape = s; savePrefs()
    if (pipWindow) { close(); await open() }
  }
  async function setSize (s) {
    size = s; savePrefs()
    if (pipWindow) { close(); await open() }
  }

  function init () {
    loadPrefs()
    // Reflejar prefs en los botones
    document.querySelectorAll('.bubble-opt').forEach(b =>
      b.classList.toggle('active', b.dataset.shape === shape))
    document.querySelectorAll('.bubble-size').forEach(b =>
      b.classList.toggle('active', b.dataset.size === size))
  }

  return { init, toggle, close, isOpen, setShape, setSize, onCameraChange, getShape: () => shape, getSize: () => size }
})()

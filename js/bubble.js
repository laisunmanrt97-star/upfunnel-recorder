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

  // ── Estudio flotante (PiP con anotaciones + cámara) ─────────────────────

  let studioCanvas = null
  let studioTools = null
  let studioOverlay = null

  function restoreStudioElements () {
    const wrap = document.getElementById('side-annotate-wrap')
    const panel = document.getElementById('rec-sidepanel')
    if (studioCanvas && wrap) wrap.appendChild(studioCanvas)
    if (studioOverlay && wrap) wrap.appendChild(studioOverlay)
    if (studioTools && panel) panel.appendChild(studioTools)
    studioCanvas = null
    studioOverlay = null
    studioTools = null
  }

  async function openStudio (canvas, toolsElement, overlayElement, controls = {}) {
    studioCanvas = canvas
    studioTools = toolsElement
    studioOverlay = overlayElement

    // Si ya hay un PiP abierto (cámara previa), lo reusamos
    if (!pipWindow) {
      pipWindow = await documentPictureInPicture.requestWindow({ width: 640, height: 480 })
    }
    // Reemplazar listener por si ya tenía uno viejo
    pipWindow.addEventListener('pagehide', () => {
      restoreStudioElements()
      pipWindow = null
    }, { once: true })

    const doc = pipWindow.document
    doc.title = 'SnapRec — Anotaciones'
    doc.body.replaceChildren()

    // Cargar estilos de la app en el PiP (URL absoluta desde el root)
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '') + '/style.css?v=128'
    doc.head.appendChild(link)

    // Body: flex column, canvas arriba, tools abajo
    doc.body.style.cssText = 'margin:0;background:#080C14;overflow:hidden;display:flex;flex-direction:column;height:100vh;font-family:Inter,sans-serif;'

    // ── Contenedor del canvas (flex: 1) ──
    const canvasWrap = doc.createElement('div')
    canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;min-height:0;'

    const stage = doc.createElement('div')
    stage.style.cssText = `position:relative;overflow:hidden;background:#000;aspect-ratio:${controls.width || canvas.width}/${controls.height || canvas.height};max-width:100%;max-height:100%;`

    function fitStage () {
      const availableW = canvasWrap.clientWidth
      const availableH = canvasWrap.clientHeight
      const ratio = (controls.width || canvas.width) / (controls.height || canvas.height)
      if (!availableW || !availableH) return
      if (availableW / availableH > ratio) {
        stage.style.width = `${Math.round(availableH * ratio)}px`
        stage.style.height = `${availableH}px`
      } else {
        stage.style.width = `${availableW}px`
        stage.style.height = `${Math.round(availableW / ratio)}px`
      }
    }

    if (controls.previewStream) {
      const preview = doc.createElement('video')
      preview.autoplay = true
      preview.muted = true
      preview.playsInline = true
      preview.srcObject = controls.previewStream
      preview.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0;'
      stage.appendChild(preview)
    }

    // Mover el canvas de anotaciones + su overlay (Tools.attach) al PiP
    if (canvas) {
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;z-index:1;'
      stage.appendChild(canvas)
      if (overlayElement) stage.appendChild(overlayElement)
    }

    if (canvas && controls.getCameraRect && controls.setCameraPosition) {
      let draggingCamera = false
      let offsetX = 0
      let offsetY = 0

      function toNative (event) {
        const rect = canvas.getBoundingClientRect()
        return {
          x: (event.clientX - rect.left) * (canvas.width / rect.width),
          y: (event.clientY - rect.top) * (canvas.height / rect.height)
        }
      }

      function isOverCamera (point) {
        const rect = controls.getCameraRect()
        return rect && point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
      }

      canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        const point = toNative(event)
        const rect = controls.getCameraRect()
        if (!rect || !isOverCamera(point)) return
        draggingCamera = true
        offsetX = point.x - rect.x
        offsetY = point.y - rect.y
        canvas.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopImmediatePropagation()
      }, true)

      canvas.addEventListener('pointermove', (event) => {
        const point = toNative(event)
        canvas.style.cursor = draggingCamera || isOverCamera(point) ? 'move' : 'crosshair'
        if (!draggingCamera) return
        controls.setCameraPosition(point.x - offsetX, point.y - offsetY)
        event.preventDefault()
        event.stopImmediatePropagation()
      }, true)

      const finishCameraDrag = (event) => {
        if (!draggingCamera) return
        draggingCamera = false
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      canvas.addEventListener('pointerup', finishCameraDrag, true)
      canvas.addEventListener('pointercancel', finishCameraDrag, true)
    }

    canvasWrap.appendChild(stage)
    doc.body.appendChild(canvasWrap)

    const hint = doc.createElement('div')
    hint.textContent = 'Dibuja sobre la vista. Arrastra la cámara dentro del video para moverla.'
    hint.style.cssText = 'padding:6px 10px;color:#94A3B8;font-size:11px;text-align:center;border-top:1px solid rgba(148,163,184,.2);'
    doc.body.appendChild(hint)
    doc.defaultView.addEventListener('resize', fitStage)
    doc.defaultView.requestAnimationFrame(fitStage)

    // ── Toolbar de anotaciones ──
    if (toolsElement) {
      if (toolsElement.parentElement) toolsElement.remove()
      doc.body.appendChild(toolsElement)
    }
  }

  function closeStudio () {
    const win = pipWindow
    restoreStudioElements()
    pipWindow = null
    if (win) win.close()
    // No detenemos camStream porque puede estar siendo usado por la grabación
  }

  return { init, open, toggle, close, isOpen, isSupported, setShape, setSize, onCameraChange, getShape: () => shape, getSize: () => size, openStudio, closeStudio }
})()

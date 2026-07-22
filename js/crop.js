// SnapRec — pipeline de video por canvas y selección de área
//  - freezeFrame(): congela un frame de un stream en un canvas
//  - selectOnFrame(): UI de selección de rectángulo sobre un frame dado
//  - selectArea(): congela + selecciona (flujo del modo área al grabar)
//  - createPipeline(): compone pantalla (+recorte) (+capa de anotaciones en
//    vivo) (+cámara incrustada) → canvas.captureStream
// Expone window.Crop

const Crop = (() => {
  const view      = document.getElementById('view-area')
  const frameCv   = document.getElementById('area-frame')
  const selectCv  = document.getElementById('area-select')

  // Tamaño de la cámara incrustada como fracción del lado menor del video
  const CAM_SIZES = { s: 0.18, m: 0.25, l: 0.33 }
  const CAM_MARGIN = 24

  // ── Utilidades de stream ───────────────────────────────────────────────────

  async function playStream (stream) {
    const v = document.createElement('video')
    v.srcObject = stream
    v.muted = true
    v.playsInline = true
    await v.play()
    if (!v.videoWidth) {
      await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }))
    }
    return v
  }

  // Congela el frame actual de un stream en un canvas nuevo
  async function freezeFrame (stream) {
    const v = await playStream(stream)
    const cv = document.createElement('canvas')
    cv.width = v.videoWidth
    cv.height = v.videoHeight
    cv.getContext('2d').drawImage(v, 0, 0)
    v.srcObject = null
    return cv
  }

  // ── Selección de área ──────────────────────────────────────────────────────

  // Muestra la UI de selección sobre un frame ya congelado
  async function selectOnFrame (frameCanvas) {
    const nativeW = frameCanvas.width
    const nativeH = frameCanvas.height
    frameCv.width = nativeW
    frameCv.height = nativeH
    frameCv.getContext('2d').drawImage(frameCanvas, 0, 0)
    selectCv.width = nativeW
    selectCv.height = nativeH
    return runSelection(nativeW, nativeH)
  }

  // Flujo del grabador: congela el stream y selecciona encima
  async function selectArea (displayStream) {
    const frame = await freezeFrame(displayStream)
    return selectOnFrame(frame)
  }

  // ── Pipeline compositor ───────────────────────────────────────────────────
  // opts: { displayStream, region|null, camStream|null, camera: {shape,size,corner},
  //         withAnnotations: bool, fps }
  // Devuelve { stream, stop, annotationCanvas, width, height }
  // Orden de capas: pantalla → anotaciones → cámara

  async function createPipeline ({ displayStream, region, camStream, camera, withAnnotations, fps, targetHeight }) {
    const srcVideo = await playStream(displayStream)
    const camVideo = camStream ? await playStream(camStream) : null

    let outW = region ? region.w : srcVideo.videoWidth
    let outH = region ? region.h : srcVideo.videoHeight

    // Escalar salida si el preset pide una altura máxima
    if (targetHeight && outH > targetHeight) {
      const scale = targetHeight / outH
      outW = Math.round(outW * scale) & ~1   // dimensiones pares
      outH = targetHeight & ~1
    }

    const cv = document.createElement('canvas')
    cv.width = outW
    cv.height = outH
    const ctx = cv.getContext('2d')

    let annotationCanvas = null
    if (withAnnotations) {
      annotationCanvas = document.createElement('canvas')
      annotationCanvas.width = outW
      annotationCanvas.height = outH
    }

    const initialPosition = camera?.position && Number.isFinite(camera.position.x) && Number.isFinite(camera.position.y)
      ? { x: Math.min(1, Math.max(0, camera.position.x)), y: Math.min(1, Math.max(0, camera.position.y)) }
      : {
          x: camera?.corner?.includes('l') ? 0 : 1,
          y: camera?.corner?.includes('t') ? 0 : 1
        }
    let cameraPosition = initialPosition

    function getCameraRect () {
      if (!camVideo || !camera) return null
      const base = Math.round(Math.min(outW, outH) * (CAM_SIZES[camera.size] || CAM_SIZES.m))
      const isCircle = camera.shape !== 'rect'
      const w = isCircle ? base : Math.round(base * 1.33)
      const h = base
      const availableX = Math.max(0, outW - w - CAM_MARGIN * 2)
      const availableY = Math.max(0, outH - h - CAM_MARGIN * 2)
      const x = Math.round(CAM_MARGIN + cameraPosition.x * availableX)
      const y = Math.round(CAM_MARGIN + cameraPosition.y * availableY)
      return { x, y, w, h, outW, outH }
    }

    function setCameraPosition (x, y) {
      const rect = getCameraRect()
      if (!rect) return
      const availableX = Math.max(1, outW - rect.w - CAM_MARGIN * 2)
      const availableY = Math.max(1, outH - rect.h - CAM_MARGIN * 2)
      cameraPosition = {
        x: Math.min(1, Math.max(0, (x - CAM_MARGIN) / availableX)),
        y: Math.min(1, Math.max(0, (y - CAM_MARGIN) / availableY))
      }
      if (camera.onPositionChange) camera.onPositionChange({ ...cameraPosition })
    }

    function drawCam () {
      const rect = getCameraRect()
      if (!rect) return
      const { x, y, w, h } = rect
      const isCircle = camera.shape !== 'rect'

      // Recorte "cover" del frame de la cámara al aspecto destino
      const cw = camVideo.videoWidth, ch = camVideo.videoHeight
      const srcAspect = cw / ch, dstAspect = w / h
      let sw, sh
      if (srcAspect > dstAspect) { sh = ch; sw = ch * dstAspect } else { sw = cw; sh = cw / dstAspect }
      const sx = (cw - sw) / 2, sy = (ch - sh) / 2

      ctx.save()
      ctx.beginPath()
      if (isCircle) {
        ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2)
      } else {
        ctx.roundRect(x, y, w, h, 10)
      }
      ctx.clip()
      ctx.drawImage(camVideo, sx, sy, sw, sh, x, y, w, h)
      ctx.restore()

      // Borde cian de marca
      ctx.beginPath()
      if (isCircle) ctx.arc(x + w / 2, y + h / 2, w / 2 - 1, 0, Math.PI * 2)
      else ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 10)
      ctx.strokeStyle = '#00E5FF'
      ctx.lineWidth = 3
      ctx.stroke()
    }

    let annotationsEnabled = true
    let cameraOnly = false

    function drawCameraFullscreen () {
      if (!camVideo) return
      const cw = camVideo.videoWidth, ch = camVideo.videoHeight
      if (!cw || !ch) return
      const scale = Math.max(outW / cw, outH / ch)
      const sw = cw * scale, sh = ch * scale
      const sx = (outW - sw) / 2, sy = (outH - sh) / 2
      ctx.fillStyle = '#080C14'
      ctx.fillRect(0, 0, outW, outH)
      ctx.drawImage(camVideo, 0, 0, cw, ch, sx, sy, sw, sh)
    }

    function drawFrame () {
      if (cameraOnly) {
        drawCameraFullscreen()
        if (annotationCanvas && annotationsEnabled) {
          ctx.drawImage(annotationCanvas, 0, 0)
        }
        return
      }
      if (region) {
        ctx.drawImage(srcVideo, region.x, region.y, region.w, region.h, 0, 0, outW, outH)
      } else {
        ctx.drawImage(srcVideo, 0, 0, outW, outH)
      }
      if (annotationCanvas && annotationsEnabled) {
        ctx.drawImage(annotationCanvas, 0, 0)
      }
      if (camVideo) drawCam()
    }

    drawFrame()
    const stream = cv.captureStream(fps)

    // Sincronizar dibujo: VFC para cambios de contenido + setInterval de respaldo
    // para garantizar frames aunque la fuente esté estática (bug: sin VFC, contenido
    // quieto = sin frames = video lagueado).
    let vfcId = null
    let timerId = null
    let lastFrameTs = performance.now()
    const frameInterval = 1000 / fps

    function onDrawFrame () {
      const now = performance.now()
      if (now - lastFrameTs >= frameInterval) {
        drawFrame()
        lastFrameTs = now
      }
    }

    timerId = setInterval(onDrawFrame, frameInterval)

    if (typeof srcVideo.requestVideoFrameCallback === 'function') {
      function onVideoFrame (now, metadata) {
        onDrawFrame()
        if (srcVideo.readyState >= 2) {
          vfcId = srcVideo.requestVideoFrameCallback(onVideoFrame)
        }
      }
      vfcId = srcVideo.requestVideoFrameCallback(onVideoFrame)
    }

    return {
      stream,
      annotationCanvas,
      width: outW,
      height: outH,
      setAnnotationsEnabled: (v) => { annotationsEnabled = v },
      setCameraOnly: (v) => { cameraOnly = v },
      getCameraRect,
      setCameraPosition,
      stop: () => {
        if (vfcId !== null && typeof srcVideo.cancelVideoFrameCallback === 'function') {
          srcVideo.cancelVideoFrameCallback(vfcId)
        }
        if (timerId !== null) clearInterval(timerId)
        srcVideo.srcObject = null
        if (camVideo) camVideo.srcObject = null
      }
    }
  }

  // ── Selección con mouse (estética Upfunnel) ───────────────────────────────

  function runSelection (nativeW, nativeH) {
    return new Promise(resolve => {
      const ctx = selectCv.getContext('2d')
      let drawing = false
      let sx = 0, sy = 0, cx = 0, cy = 0
      let dashOffset = 0
      let raf = null

      view.hidden = false

      // El canvas se muestra escalado por CSS — mapear a píxeles nativos
      function toNative (e) {
        const r = selectCv.getBoundingClientRect()
        return {
          x: Math.round((e.clientX - r.left) * (nativeW / r.width)),
          y: Math.round((e.clientY - r.top) * (nativeH / r.height))
        }
      }

      function draw () {
        dashOffset -= 1
        ctx.clearRect(0, 0, nativeW, nativeH)
        if (drawing) {
          const x = Math.min(sx, cx), y = Math.min(sy, cy)
          const w = Math.abs(cx - sx), h = Math.abs(cy - sy)
          if (w > 2 && h > 2) {
            // Oscurecer lo NO seleccionado
            ctx.fillStyle = 'rgba(8, 12, 20, 0.6)'
            ctx.fillRect(0, 0, nativeW, nativeH)
            ctx.clearRect(x, y, w, h)
            // Borde punteado animado
            ctx.strokeStyle = '#00E5FF'
            ctx.lineWidth = 2
            ctx.setLineDash([8, 4])
            ctx.lineDashOffset = dashOffset
            ctx.strokeRect(x, y, w, h)
            // Dimensiones
            ctx.setLineDash([])
            const label = `${w} × ${h} px`
            ctx.font = '600 16px Inter, sans-serif'
            const tw = ctx.measureText(label).width
            const ly = y > 30 ? y - 10 : y + h + 24
            ctx.fillStyle = 'rgba(8, 12, 20, 0.85)'
            ctx.fillRect(x + w / 2 - tw / 2 - 8, ly - 18, tw + 16, 24)
            ctx.fillStyle = '#00E5FF'
            ctx.fillText(label, x + w / 2 - tw / 2, ly)
          }
        }
        raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)

      function onDown (e) {
        if (e.button !== 0) return
        drawing = true
        const p = toNative(e); sx = cx = p.x; sy = cy = p.y
      }
      function onMove (e) {
        if (!drawing) return
        const p = toNative(e); cx = p.x; cy = p.y
      }
      function onUp () {
        if (!drawing) return
        drawing = false
        const x = Math.min(sx, cx), y = Math.min(sy, cy)
        // Dimensiones pares (algunos encoders lo exigen)
        const w = Math.abs(cx - sx) & ~1
        const h = Math.abs(cy - sy) & ~1
        if (w < 100 || h < 100) return   // muy pequeño, seguir seleccionando
        finish({ x, y, w, h })
      }
      function onKey (e) {
        if (e.key === 'Escape') finish(null)
      }

      function finish (result) {
        cancelAnimationFrame(raf)
        ctx.clearRect(0, 0, nativeW, nativeH)
        selectCv.removeEventListener('mousedown', onDown)
        selectCv.removeEventListener('mousemove', onMove)
        selectCv.removeEventListener('mouseup', onUp)
        window.removeEventListener('keydown', onKey)
        view.hidden = true
        resolve(result)
      }

      selectCv.addEventListener('mousedown', onDown)
      selectCv.addEventListener('mousemove', onMove)
      selectCv.addEventListener('mouseup', onUp)
      window.addEventListener('keydown', onKey)
    })
  }

  return { playStream, freezeFrame, selectOnFrame, selectArea, createPipeline }
})()

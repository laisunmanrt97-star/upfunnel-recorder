// SnapRec — modo área: selección sobre un frame congelado + pipeline de recorte
// Patrón visual heredado del overlay de SnapEdit (borde punteado verde animado).
// Expone window.Crop

const Crop = (() => {
  const view      = document.getElementById('view-area')
  const frameCv   = document.getElementById('area-frame')
  const selectCv  = document.getElementById('area-select')

  // Muestra el frame congelado, deja seleccionar un rectángulo y devuelve
  // { stream, stop } con el video recortado, o null si el usuario cancela.
  async function selectAndCrop (displayStream, fps) {
    const srcVideo = document.createElement('video')
    srcVideo.srcObject = displayStream
    srcVideo.muted = true
    await srcVideo.play()
    // Esperar dimensiones reales
    if (!srcVideo.videoWidth) {
      await new Promise(r => srcVideo.addEventListener('loadedmetadata', r, { once: true }))
    }
    const nativeW = srcVideo.videoWidth
    const nativeH = srcVideo.videoHeight

    // Frame congelado para seleccionar encima
    frameCv.width = nativeW
    frameCv.height = nativeH
    frameCv.getContext('2d').drawImage(srcVideo, 0, 0)
    selectCv.width = nativeW
    selectCv.height = nativeH

    const region = await runSelection(nativeW, nativeH)
    if (!region) {
      srcVideo.srcObject = null
      return null
    }

    // ── Pipeline de recorte: video → canvas recortado → captureStream ──
    const cropCv = document.createElement('canvas')
    cropCv.width = region.w
    cropCv.height = region.h
    const cropCtx = cropCv.getContext('2d')

    const interval = setInterval(() => {
      cropCtx.drawImage(srcVideo, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h)
    }, 1000 / fps)

    const stream = cropCv.captureStream(fps)

    return {
      stream,
      stop: () => {
        clearInterval(interval)
        srcVideo.srcObject = null
      }
    }
  }

  // ── Selección con mouse (estética SnapEdit) ───────────────────────────────

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
            ctx.fillStyle = 'rgba(13, 13, 13, 0.6)'
            ctx.fillRect(0, 0, nativeW, nativeH)
            ctx.clearRect(x, y, w, h)
            // Borde punteado animado
            ctx.strokeStyle = '#00FF88'
            ctx.lineWidth = 2
            ctx.setLineDash([8, 4])
            ctx.lineDashOffset = dashOffset
            ctx.strokeRect(x, y, w, h)
            // Dimensiones
            ctx.setLineDash([])
            const label = `${w} × ${h} px`
            ctx.font = '16px JetBrains Mono, monospace'
            const tw = ctx.measureText(label).width
            const ly = y > 30 ? y - 10 : y + h + 24
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
            ctx.fillRect(x + w / 2 - tw / 2 - 8, ly - 18, tw + 16, 24)
            ctx.fillStyle = '#00FF88'
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

  return { selectAndCrop }
})()

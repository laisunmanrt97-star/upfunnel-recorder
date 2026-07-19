// SnapRec — herramientas de dibujo compartidas (portadas de SnapEdit)
// Usadas por el editor de capturas (todas) y la anotación en vivo (subset).
// Expone window.Tools

const Tools = (() => {
  const INKS = ['#FF4444', '#FFE000', '#00AAFF', '#00E5FF', '#FFFFFF', '#000000']

  function drawArrow (ctx, x1, y1, x2, y2, color, size) {
    const headLen = Math.max(14, size * 4)
    const angle = Math.atan2(y2 - y1, x2 - x1)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
  }

  function applyPixelate (ctx, rx, ry, rw, rh) {
    if (rw < 4 || rh < 4) return
    const block = 12
    const data = ctx.getImageData(rx, ry, rw, rh)
    for (let py = 0; py < rh; py += block) {
      for (let px = 0; px < rw; px += block) {
        const i = (py * rw + px) * 4
        const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2]
        for (let fy = 0; fy < block && py + fy < rh; fy++) {
          for (let fx = 0; fx < block && px + fx < rw; fx++) {
            const j = ((py + fy) * rw + (px + fx)) * 4
            data.data[j] = r; data.data[j + 1] = g; data.data[j + 2] = b
          }
        }
      }
    }
    ctx.putImageData(data, rx, ry)
  }

  // ── Superficie de dibujo interactiva ───────────────────────────────────────
  // attach(canvas, opts) conecta pointer events y devuelve API de dibujo.
  //
  // opts:
  //   getTool(), getColor(), getSize()
  //   onText(x, y), onCrop(region), onChange()
  //   maxHistory: tope de snapshots de undo (default 25)
  //
  // Usa un overlay canvas para rubber-banding de formas (arrow/rect/ellipse/fill):
  // la previsualización durante el arrastre se dibuja en el overlay, evitando
  // getImageData/putImageData de todo el canvas en cada mousemove.
  // Solo se usa getImageData al soltar el trazo (1 vez por gesto, no por frame).

  function attach (canvas, opts) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const maxHistory = opts.maxHistory || 25
    let history = []
    let redoStack = []
    let drawing = false
    let startX = 0, startY = 0, lastX = 0, lastY = 0
    let snapshot = null   // solo para pixelate/crop

    // ── Overlay canvas (evita getImageData/putImageData en cada mousemove) ──
    const overlay = document.createElement('canvas')
    overlay.width = canvas.width
    overlay.height = canvas.height
    const oCtx = overlay.getContext('2d')
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;'
    const parent = canvas.parentElement
    if (parent) {
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
      parent.appendChild(overlay)
    }
    function syncOverlaySize () {
      overlay.width = canvas.width
      overlay.height = canvas.height
    }
    function clearOverlay () { oCtx.clearRect(0, 0, overlay.width, overlay.height) }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function toNative (e) {
      const r = canvas.getBoundingClientRect()
      return {
        x: Math.round((e.clientX - r.left) * (canvas.width / r.width)),
        y: Math.round((e.clientY - r.top) * (canvas.height / r.height))
      }
    }

    function pushHistory () {
      history.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
      if (history.length > maxHistory) history.shift()
      redoStack = []
      if (opts.onChange) opts.onChange()
    }

    function resetCanvasCtx () {
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      ctx.setLineDash([])
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }

    // ── Eventos ──────────────────────────────────────────────────────────────

    function onDown (e) {
      if (e.button !== 0) return
      const tool = opts.getTool()
      const p = toNative(e)
      startX = lastX = p.x
      startY = lastY = p.y

      if (tool === 'text') {
        if (opts.onText) opts.onText(p.x, p.y)
        return
      }

      drawing = true
      canvas.setPointerCapture(e.pointerId)
      clearOverlay()
      resetCanvasCtx()

      // Snapshot solo para pixelate/crop (operan sobre píxeles existentes)
      if (tool === 'pixelate' || tool === 'crop') {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
      }

      if (tool === 'pen' || tool === 'highlight') {
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
      }
    }

    function onMove (e) {
      if (!drawing) return
      const tool = opts.getTool()
      const p = toNative(e)
      const color = opts.getColor()
      const size = opts.getSize()

      switch (tool) {
        // ── Incremental: dibuja directo en canvas principal ──
        case 'pen':
          resetCanvasCtx()
          ctx.strokeStyle = color
          ctx.lineWidth = size
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          break

        case 'highlight':
          resetCanvasCtx()
          ctx.globalAlpha = 0.35
          ctx.strokeStyle = '#FFE000'
          ctx.lineWidth = size * 5
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          break

        // ── Formas: previsualización en overlay, commit en onUp ──
        case 'arrow':
          clearOverlay()
          drawArrow(oCtx, startX, startY, p.x, p.y, color, size)
          break

        case 'rect':
          clearOverlay()
          oCtx.strokeStyle = color
          oCtx.lineWidth = size
          oCtx.strokeRect(Math.min(startX, p.x), Math.min(startY, p.y),
                          Math.abs(p.x - startX), Math.abs(p.y - startY))
          break

        case 'ellipse':
          clearOverlay()
          oCtx.strokeStyle = color
          oCtx.lineWidth = size
          oCtx.beginPath()
          oCtx.ellipse((startX + p.x) / 2, (startY + p.y) / 2,
                       Math.abs(p.x - startX) / 2, Math.abs(p.y - startY) / 2, 0, 0, Math.PI * 2)
          oCtx.stroke()
          break

        case 'fill':
          clearOverlay()
          oCtx.fillStyle = '#000000'
          oCtx.fillRect(Math.min(startX, p.x), Math.min(startY, p.y),
                        Math.abs(p.x - startX), Math.abs(p.y - startY))
          break

        // ── Pixelate / Crop: overlay para selección, snapshot para operar ──
        case 'pixelate':
        case 'crop':
          clearOverlay()
          oCtx.strokeStyle = '#00E5FF'
          oCtx.lineWidth = 2
          oCtx.setLineDash([6, 4])
          oCtx.strokeRect(Math.min(startX, p.x), Math.min(startY, p.y),
                          Math.abs(p.x - startX), Math.abs(p.y - startY))
          oCtx.setLineDash([])
          break
      }

      lastX = p.x; lastY = p.y
    }

    function onUp (e) {
      if (!drawing) return
      drawing = false
      const tool = opts.getTool()
      const p = toNative(e)
      const rx = Math.min(startX, p.x), ry = Math.min(startY, p.y)
      const rw = Math.abs(p.x - startX), rh = Math.abs(p.y - startY)

      clearOverlay()

      if (tool === 'pixelate') {
        ctx.putImageData(snapshot, 0, 0)
        if (rw > 4 && rh > 4) applyPixelate(ctx, rx, ry, rw, rh)
        snapshot = null
        pushHistory()
        return
      }

      if (tool === 'crop') {
        ctx.putImageData(snapshot, 0, 0)
        snapshot = null
        if (rw > 20 && rh > 20 && opts.onCrop) {
          opts.onCrop({ x: rx, y: ry, w: rw, h: rh })
          return
        }
        pushHistory()
        return
      }

      // Formas (arrow / rect / ellipse / fill): commit al canvas principal
      if (tool === 'arrow' || tool === 'rect' || tool === 'ellipse' || tool === 'fill') {
        resetCanvasCtx()
        const color = opts.getColor()
        const size = opts.getSize()
        switch (tool) {
          case 'arrow':
            drawArrow(ctx, startX, startY, p.x, p.y, color, size)
            break
          case 'rect':
            ctx.strokeStyle = color
            ctx.lineWidth = size
            ctx.strokeRect(Math.min(startX, p.x), Math.min(startY, p.y),
                           Math.abs(p.x - startX), Math.abs(p.y - startY))
            break
          case 'ellipse':
            ctx.strokeStyle = color
            ctx.lineWidth = size
            ctx.beginPath()
            ctx.ellipse((startX + p.x) / 2, (startY + p.y) / 2,
                        Math.abs(p.x - startX) / 2, Math.abs(p.y - startY) / 2, 0, 0, Math.PI * 2)
            ctx.stroke()
            break
          case 'fill':
            ctx.fillStyle = '#000000'
            ctx.fillRect(Math.min(startX, p.x), Math.min(startY, p.y),
                         Math.abs(p.x - startX), Math.abs(p.y - startY))
            break
        }
        pushHistory()
        return
      }

      // Pen / highlight: solo guardar historial
      if (tool === 'pen' || tool === 'highlight') {
        pushHistory()
      }
    }

    // ── API de texto ──────────────────────────────────────────────────────────

    function commitText (text, x, y, color, size) {
      if (!text.trim()) return
      resetCanvasCtx()
      ctx.font = `600 ${size * 7 + 10}px Inter, 'Segoe UI', sans-serif`
      ctx.fillStyle = color
      ctx.fillText(text, x, y)
      pushHistory()
    }

    // ── Undo / Redo / Clear ──────────────────────────────────────────────────

    function undo () {
      if (history.length < 2) return
      redoStack.push(history.pop())
      ctx.putImageData(history[history.length - 1], 0, 0)
      if (opts.onChange) opts.onChange()
    }

    function redo () {
      if (!redoStack.length) return
      const img = redoStack.pop()
      history.push(img)
      ctx.putImageData(img, 0, 0)
      if (opts.onChange) opts.onChange()
    }

    function clear () {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      pushHistory()
    }

    // ── Registrar eventos ────────────────────────────────────────────────────

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    pushHistory()

    return {
      undo, redo, clear, commitText, pushHistory, syncOverlaySize,
      overlayCanvas: overlay,
      canUndo: () => history.length > 1,
      canRedo: () => redoStack.length > 0,
      resetHistory: () => { history = []; redoStack = []; pushHistory() },
      destroy: () => {
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        if (overlay.parentElement) overlay.remove()
      }
    }
  }

  // ── Cuenta regresiva (usa el overlay #countdown) ──────────────────────────

  function countdown (n, hint = '') {
    return new Promise(resolve => {
      const el = document.getElementById('countdown')
      const num = document.getElementById('countdown-num')
      const hintEl = document.getElementById('countdown-hint')
      el.hidden = false
      num.textContent = n
      hintEl.textContent = hint
      const iv = setInterval(() => {
        n--
        if (n <= 0) {
          clearInterval(iv)
          el.hidden = true
          resolve()
        } else {
          num.textContent = n
        }
      }, 1000)
    })
  }

  // ── Input de texto flotante sobre un canvas ───────────────────────────────
  // Coordenadas x/y en píxeles nativos del canvas; el input se posiciona en
  // pantalla escalando según el tamaño renderizado.

  function textInput ({ canvas, x, y, color, size, onCommit }) {
    const existing = document.getElementById('snaprec-text-input')
    if (existing) existing.remove()

    const r = canvas.getBoundingClientRect()
    const scale = r.width / canvas.width
    const fontPx = Math.max(14, (size * 7 + 10) * scale)

    const input = document.createElement('input')
    input.id = 'snaprec-text-input'
    input.type = 'text'
    input.setAttribute('aria-label', 'Texto de la anotación')
    input.style.cssText = `
      position: fixed;
      left: ${r.left + x * scale}px;
      top: ${r.top + y * scale - fontPx}px;
      background: rgba(8, 12, 20, 0.85);
      border: 1px solid ${color};
      color: ${color};
      font: 600 ${fontPx}px Inter, 'Segoe UI', sans-serif;
      padding: 2px 8px;
      outline: none;
      min-width: 90px;
      z-index: 9999;
    `
    document.body.appendChild(input)
    requestAnimationFrame(() => input.focus())

    let committed = false
    const commit = () => {
      if (committed) return
      committed = true
      if (input.value.trim()) onCommit(input.value)
      input.remove()
      document.removeEventListener('mousedown', outsideClick, true)
    }
    const cancel = () => {
      committed = true
      input.remove()
      document.removeEventListener('mousedown', outsideClick, true)
    }
    const outsideClick = (e) => { if (e.target !== input) commit() }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
      if (e.key === 'Escape') cancel()
      e.stopPropagation()
    })
    // Evitar que el mousedown que abrió el input lo cierre en el mismo ciclo
    setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 60)
  }

  return { attach, drawArrow, applyPixelate, countdown, textInput, INKS }
})()

// SnapRec — máquina de estados de la UI
// Pestañas: GRABAR (setup → grabando/estudio → resultado) y CAPTURAR (→ editor)

(() => {
  const views = {
    setup: document.getElementById('view-setup'),
    rec:   document.getElementById('view-rec'),
    edit:  document.getElementById('view-edit'),
    done:  document.getElementById('view-done')
  }
  const headerStatus = document.getElementById('header-status')

  let mainTab = 'record'    // record | capture
  let mode = 'full'         // full | area   (grabación)
  let capMode = 'full'      // full | area   (captura)
  // Auto-detectar preset según CPU: ≤4 cores → liviano, sino → HD
  let quality = (navigator.hardwareConcurrency || 8) <= 4 ? 'light15' : 'hd720'
  let camMode = 'embed'     // embed | off
  let camCorner = 'br'      // tl | tr | bl | br
  let camPosition = null    // posición libre normalizada { x, y }
  let saveDirect = false
  let lastResult = null
  let lastObjectUrl = null

  let recTools = null       // estado del toolbar del estudio
  let editTools = null      // estado del toolbar del editor de capturas
  let studioSurface = null  // Tools.attach del estudio (para teardown)

  const PREF_KEY = 'snaprec-opts'

  function loadPrefs () {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY)) || {}
      if (p.mainTab) mainTab = p.mainTab
      if (p.mode) mode = p.mode
      if (p.capMode) capMode = p.capMode
      if (p.quality) quality = p.quality
      if (p.camMode) camMode = p.camMode
      if (p.camCorner) camCorner = p.camCorner
      if (typeof p.saveDirect === 'boolean') saveDirect = p.saveDirect
      if (p.camPosition && Number.isFinite(p.camPosition.x) && Number.isFinite(p.camPosition.y)) camPosition = p.camPosition
    } catch {}
  }
  function savePrefs () {
    localStorage.setItem(PREF_KEY, JSON.stringify({ mainTab, mode, capMode, quality, camMode, camCorner, camPosition, saveDirect }))
  }

  function showView (name) {
    for (const [k, el] of Object.entries(views)) el.hidden = (k !== name)
  }

  function setStatus (txt) { headerStatus.textContent = txt }

  // ── Soporte del navegador ────────────────────────────────────────────────

  function checkSupport () {
    const ok = navigator.mediaDevices &&
               navigator.mediaDevices.getDisplayMedia &&
               window.MediaRecorder
    if (!ok) {
      document.getElementById('unsupported').hidden = false
      document.getElementById('btn-record').disabled = true
      document.getElementById('btn-capture').disabled = true
    }
    return ok
  }

  // ── Toolbars de anotación (estudio y editor comparten estructura) ────────

  function wireToolbar (barId) {
    const bar = document.getElementById(barId)
    const state = { tool: 'pen', color: Tools.INKS[0], size: 4, api: null }

    const swWrap = bar.querySelector('.ink-swatches')
    Tools.INKS.forEach((ink, i) => {
      const b = document.createElement('button')
      b.className = 'ink-swatch' + (i === 0 ? ' active' : '')
      b.dataset.inkIndex = i
      b.title = ink
      b.setAttribute('aria-label', 'Color de tinta ' + ink)
      b.addEventListener('click', () => {
        state.color = ink
        swWrap.querySelectorAll('.ink-swatch').forEach(s => s.classList.toggle('active', s === b))
      })
      swWrap.appendChild(b)
    })

    bar.querySelectorAll('[data-tool]').forEach(b =>
      b.addEventListener('click', () => {
        state.tool = b.dataset.tool
        bar.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('active', x === b))
      }))

    const sizeVal = bar.querySelector('.size-val')
    bar.querySelectorAll('[data-act]').forEach(b =>
      b.addEventListener('click', () => {
        const act = b.dataset.act
        if (act === 'size-inc') { state.size = Math.min(14, state.size + 1); sizeVal.textContent = state.size }
        else if (act === 'size-dec') { state.size = Math.max(1, state.size - 1); sizeVal.textContent = state.size }
        else if (state.api) {
          if (act === 'undo') state.api.undo()
          if (act === 'redo') state.api.redo()
          if (act === 'clear') state.api.clear()
        }
      }))

    return state
  }

  // ── Opciones del setup ───────────────────────────────────────────────────

  function wireOptions () {
    // Pestañas principales
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === mainTab)
      btn.addEventListener('click', () => {
        mainTab = btn.dataset.tab
        if (mainTab !== 'record') { Devices.stopVuMeter(); Bubble.close() }
        if (mainTab !== 'capture') Capture.stopStream()
        savePrefs()
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn))
        document.getElementById('setup-record').hidden = (mainTab !== 'record')
        document.getElementById('setup-capture').hidden = (mainTab !== 'capture')
        document.getElementById('setup-dashboard').hidden = (mainTab !== 'dashboard')
        if (mainTab === 'dashboard') Dashboard.init()
      })
    })
    document.getElementById('setup-record').hidden = (mainTab !== 'record')
    document.getElementById('setup-capture').hidden = (mainTab !== 'capture')
    document.getElementById('setup-dashboard').hidden = (mainTab !== 'dashboard')
    if (mainTab === 'dashboard') setTimeout(() => Dashboard.init(), 100)

    // Modo de grabación
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode)
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode
        savePrefs()
        document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn))
        document.getElementById('area-warning').hidden = (mode !== 'area')
      })
    })
    document.getElementById('area-warning').hidden = (mode !== 'area')

    const saveDirectInput = document.getElementById('save-direct')
    if (!window.showSaveFilePicker) {
      saveDirect = false
      saveDirectInput.disabled = true
      saveDirectInput.parentElement.title = 'Tu navegador no admite guardado directo'
    }
    saveDirectInput.checked = saveDirect
    saveDirectInput.addEventListener('change', () => {
      saveDirect = saveDirectInput.checked
      savePrefs()
    })

    // Advertencia de CPU si tiene pocos núcleos
    const cpuWarn = document.getElementById('cpu-warning')
    if ((navigator.hardwareConcurrency || 8) <= 4) cpuWarn.hidden = false

    // Área de captura
    document.querySelectorAll('[data-capmode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.capmode === capMode)
      btn.addEventListener('click', () => {
        capMode = btn.dataset.capmode
        savePrefs()
        document.querySelectorAll('[data-capmode]').forEach(b => b.classList.toggle('active', b === btn))
      })
    })

    // Calidad
    document.querySelectorAll('[data-quality]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.quality === quality)
      btn.addEventListener('click', () => {
        quality = btn.dataset.quality
        savePrefs()
        document.querySelectorAll('[data-quality]').forEach(b => b.classList.toggle('active', b === btn))
      })
    })

    // Cámara
    document.querySelectorAll('.cam-mode').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cammode === camMode)
      btn.addEventListener('click', () => {
        camMode = btn.dataset.cammode
        savePrefs()
        document.querySelectorAll('.cam-mode').forEach(b => b.classList.toggle('active', b === btn))
        document.getElementById('cam-embed-opts').classList.toggle('disabled-options', camMode !== 'embed')
      })
    })
    document.getElementById('cam-embed-opts').classList.toggle('disabled-options', camMode !== 'embed')

    document.querySelectorAll('.cam-corner').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.corner === camCorner)
      btn.addEventListener('click', () => {
        camCorner = btn.dataset.corner
        camPosition = null
        savePrefs()
        document.querySelectorAll('.cam-corner').forEach(b => b.classList.toggle('active', b === btn))
      })
    })

    document.getElementById('btn-bubble').addEventListener('click', () => Bubble.toggle())
    document.querySelectorAll('.bubble-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.bubble-opt').forEach(b => b.classList.toggle('active', b === btn))
        Bubble.setShape(btn.dataset.shape)
      }))
    document.querySelectorAll('.bubble-size').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('.bubble-size').forEach(b => b.classList.toggle('active', b === btn))
        Bubble.setSize(btn.dataset.size)
      }))
  }

  // ── Estudio de grabación (preview + anotación en vivo) ──────────────────

  function mountStudio () {
    const studio = Recorder.getStudio()
    if (!studio) return

    const preview = document.getElementById('rec-preview')
    preview.srcObject = studio.stream

    const annotate = studio.annotationCanvas
    const sidePanel = document.getElementById('rec-sidepanel')
    const toggleBtn = document.getElementById('btn-toggle-panel')

    if (annotate) {
      annotate.id = 'rec-annotate'
      annotate.setAttribute('aria-label', 'Superficie de anotación en vivo')

      // ── Panel lateral (sin PiP: la ventana flotante se capturaría por
      //     el screen share y crearía duplicados en el video) ──
      const wrap = document.getElementById('side-annotate-wrap')
      wrap.replaceChildren()
      wrap.appendChild(annotate)

      studioSurface = Tools.attach(annotate, {
        getTool:  () => recTools.tool,
        getColor: () => recTools.color,
        getSize:  () => recTools.size,
        maxHistory: 3,
        onText: (x, y) => {
          Tools.textInput({
            canvas: annotate, x, y,
            color: recTools.color,
            size: recTools.size,
            onCommit: (text) => studioSurface.commitText(text, x, y, recTools.color, recTools.size)
          })
        }
      })

      // Arrastre de cámara dentro del canvas de anotaciones (misma lógica
      // que estaba en Bubble.openStudio)
      if (studio.getCameraRect && studio.setCameraPosition) {
        let draggingCamera = false
        let offsetX = 0, offsetY = 0

        function toNative (event) {
          const rect = annotate.getBoundingClientRect()
          return {
            x: (event.clientX - rect.left) * (annotate.width / rect.width),
            y: (event.clientY - rect.top) * (annotate.height / rect.height)
          }
        }

        function isOverCamera (point) {
          const rect = studio.getCameraRect()
          return rect && point.x >= rect.x && point.x <= rect.x + rect.w &&
                 point.y >= rect.y && point.y <= rect.y + rect.h
        }

        annotate.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          const point = toNative(event)
          const rect = studio.getCameraRect()
          if (!rect || !isOverCamera(point)) return
          draggingCamera = true
          offsetX = point.x - rect.x
          offsetY = point.y - rect.y
          annotate.setPointerCapture(event.pointerId)
          event.preventDefault()
          event.stopImmediatePropagation()
        }, true)

        annotate.addEventListener('pointermove', (event) => {
          const point = toNative(event)
          annotate.style.cursor = draggingCamera || isOverCamera(point) ? 'move' : 'crosshair'
          if (!draggingCamera) return
          studio.setCameraPosition(point.x - offsetX, point.y - offsetY)
          event.preventDefault()
          event.stopImmediatePropagation()
        }, true)

        const finishCameraDrag = (event) => {
          if (!draggingCamera) return
          draggingCamera = false
          event.preventDefault()
          event.stopImmediatePropagation()
        }
        annotate.addEventListener('pointerup', finishCameraDrag, true)
        annotate.addEventListener('pointercancel', finishCameraDrag, true)
      }

      recTools.api = studioSurface
      sidePanel.classList.remove('collapsed')
      toggleBtn.hidden = false
      toggleBtn.textContent = '✏ PANEL'
      toggleBtn.classList.add('active')
    } else {
      // Bypass: ocultar todo el panel lateral
      sidePanel.classList.add('collapsed')
      toggleBtn.hidden = true
    }

    // ── Botón cámara fullscreen ──
    const btnCamFull = document.getElementById('btn-cam-full')
    function updateCamFullBtn (active) {
      btnCamFull.classList.toggle('active', active)
      btnCamFull.textContent = active ? '🎥 PANTALLA' : '🎥 CÁMARA'
    }
    updateCamFullBtn(false)
    btnCamFull.onclick = () => {
      const studio = Recorder.getStudio()
      const isActive = btnCamFull.classList.contains('active')
      const next = !isActive
      updateCamFullBtn(next)
      if (studio && studio.setCameraOnly) studio.setCameraOnly(next)
    }
  }

  function teardownStudio () {
    stopMetricsInterval()
    Bubble.closeStudio()
    const preview = document.getElementById('rec-preview')
    preview.srcObject = null
    if (studioSurface) { studioSurface.destroy(); studioSurface = null }
    recTools.api = null
  }

  // ── Flujo de grabación ───────────────────────────────────────────────────

  async function startFlow () {
    if (saveDirect) {
      const target = await Recorder.pickSaveTarget()
      if (target === 'cancelled') return
    }

    // 1. Capturar configuración de la cámara desde la burbuja
    const camera = camMode === 'embed'
      ? {
          shape: Bubble.getShape(),
          size: Bubble.getSize(),
          corner: camCorner,
          position: camPosition,
          onPositionChange: (position) => {
            camPosition = position
            document.querySelectorAll('.cam-corner').forEach(b => b.classList.remove('active'))
            savePrefs()
          }
        }
      : null

    // 2. Cerrar burbuja flotante antes de grabar: el compositor (Crop)
    //    dibuja la cámara directamente en el video, evitando que la ventana
    //    PiP aparezca duplicada por la captura de pantalla.
    if (camMode === 'embed') Bubble.close()

    // 3. Compartir pantalla + (opcional) seleccionar área + preparar recorder
    setStatus('PREPARANDO…')
    Object.values(views).forEach(v => { v.hidden = true })   // deja lugar a view-area
    let started
    try {
      started = await Recorder.start({ mode, quality, camera, onStop: onRecordingDone })
    } catch (err) {
      Recorder.abort()
      showView('setup')
      setStatus('LISTO')
      if (err.name === 'NotSupportedError') {
        alert('Tu navegador no puede generar MP4 compatible. Actualiza Chrome o Edge a la versión más reciente.')
      } else if (err.name !== 'NotAllowedError') {
        alert('No se pudo iniciar la grabación: ' + err.name)
        console.error('[SnapRec]', err)
      }
      return
    }
    if (!started) {
      showView('setup')
      setStatus('LISTO')
      return
    }   // canceló la selección de área

    // 3. Cuenta regresiva — el recorder ya corre, así que pausamos durante el 3-2-1
    Recorder.togglePause()
    Devices.stopVuMeter()
    await Tools.countdown(3)
    if (!Recorder.isRecording()) return
    Recorder.togglePause()

    document.querySelector('.rec-topbar').classList.remove('paused')
    document.getElementById('btn-pause').textContent = '‖ PAUSAR'
    // Sincronizar título escrito antes de la cuenta regresiva
    const titleInput = document.getElementById('rec-title')
    Recorder.setTitle(titleInput.value)
    mountStudio()
    document.getElementById('btn-stop').disabled = false
    updateMetricsOnce()
    startMetricsInterval()
    showView('rec')
    setStatus('GRABANDO')
  }

  // ── Métricas en vivo ───────────────────────────────────────────────────────

  let metricsInterval = null

  function updateMetricsOnce () {
    const info = Recorder.getInfo()
    document.getElementById('met-res').textContent = info.width && info.height
      ? `${info.width}×${info.height}`
      : '—×—'
    document.getElementById('met-codec').textContent = info.codec || '—'
    document.getElementById('met-size').textContent = '0 MB'
  }

  function startMetricsInterval () {
    if (metricsInterval) clearInterval(metricsInterval)
    metricsInterval = setInterval(() => {
      const info = Recorder.getInfo()
      const mb = (info.bytes / 1_048_576).toFixed(1)
      document.getElementById('met-size').textContent = `${mb} MB`
    }, 1000)
  }

  function stopMetricsInterval () {
    if (metricsInterval) { clearInterval(metricsInterval); metricsInterval = null }
  }

  function onRecordingDone (result) {
    lastResult = result
    Bubble.close()
    teardownStudio()

    // Traer el foco a SnapRec (útil cuando "Dejar de compartir" focus la otra ventana)
    window.focus()

    // Guardar metadatos en estadísticas
    const recMeta = result.info
    Stats.save({
      timestamp: Date.now(),
      duration: recMeta.duration,
      size: result.bytes,
      width: recMeta.width,
      height: recMeta.height,
      codec: recMeta.codec,
      mode: mode,
      quality: quality,
      camera: camMode,
      name: result.name,
      title: Recorder.getTitle() || result.name
    }).catch(() => {})

    const info = document.getElementById('done-info')
    const preview = document.getElementById('done-preview')
    const btnDownload = document.getElementById('btn-download')
    const mb = (result.bytes / 1_048_576).toFixed(1)

    if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null }

    if (result.saved === 'disk') {
      info.textContent = `Guardado directamente en tu PC: ${result.name} (${mb} MB)`
      btnDownload.hidden = true
      result.handle.getFile().then(f => {
        lastObjectUrl = URL.createObjectURL(f)
        preview.src = lastObjectUrl
        preview.hidden = false
      }).catch(() => { preview.hidden = true })
    } else {
      info.textContent = `${result.name} (${mb} MB) — revísalo y descárgalo. Si sales sin descargar, la grabación se pierde.`
      lastObjectUrl = URL.createObjectURL(result.blob)
      preview.src = lastObjectUrl
      preview.hidden = false
      btnDownload.hidden = false
    }

    showView('done')
    setStatus('LISTO')
  }

  function wireRecordingControls () {
    document.getElementById('btn-record').addEventListener('click', startFlow)

    document.getElementById('rec-title').addEventListener('input', (e) => {
      Recorder.setTitle(e.target.value)
    })

    document.getElementById('btn-pause').addEventListener('click', () => {
      const state = Recorder.togglePause()
      document.getElementById('btn-pause').textContent = state === 'paused' ? '▶ REANUDAR' : '‖ PAUSAR'
      document.querySelector('.rec-topbar').classList.toggle('paused', state === 'paused')
      setStatus(state === 'paused' ? 'EN PAUSA — puedes dibujar' : 'GRABANDO')
    })

    document.getElementById('btn-stop').addEventListener('click', (e) => {
      e.currentTarget.disabled = true
      Recorder.stop()
    })

    document.getElementById('btn-toggle-panel').addEventListener('click', () => {
      const studio = Recorder.getStudio()
      if (!studio) return
      const panel = document.getElementById('rec-sidepanel')
      const isCollapsed = panel.classList.toggle('collapsed')
      const btn = document.getElementById('btn-toggle-panel')
      if (studio.setAnnotationsEnabled) studio.setAnnotationsEnabled(!isCollapsed)
      btn.textContent = isCollapsed ? '✏ MOSTRAR' : '✏ PANEL'
      btn.classList.toggle('active', !isCollapsed)
    })

    document.getElementById('btn-download').addEventListener('click', () => {
      if (!lastResult || lastResult.saved !== 'memory') return
      const a = document.createElement('a')
      a.href = lastObjectUrl
      a.download = lastResult.name
      a.click()
    })

    document.getElementById('btn-again').addEventListener('click', () => {
      const preview = document.getElementById('done-preview')
      preview.pause()
      preview.removeAttribute('src')
      if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null }
      showView('setup')
      setStatus('LISTO')
    })

  }

  function updateCapStopButtons () {
    const hasStream = Capture.hasLiveStream()
    document.getElementById('btn-cap-stop').hidden = !hasStream
    document.getElementById('btn-edit-stop').hidden = !hasStream
  }

  function stopCaptureStream () {
    Capture.stopStream()
    updateCapStopButtons()
  }

  // ── Flujo de captura ─────────────────────────────────────────────────────

  async function captureFlow () {
    setStatus('CAPTURANDO…')
    Object.values(views).forEach(v => { v.hidden = true })
    let ok
    try {
      ok = await Capture.take(capMode)
    } catch (err) {
      stopCaptureStream()
      showView('setup')
      setStatus('LISTO')
      if (err.name !== 'NotAllowedError') {
        alert('No se pudo capturar: ' + err.name)
        console.error('[SnapRec]', err)
      }
      return
    }
    updateCapStopButtons()
    if (ok) { showView('edit'); setStatus('EDITANDO') }
    else { stopCaptureStream(); showView('setup'); setStatus('LISTO') }
  }

  function wireCaptureControls () {
    document.getElementById('btn-capture').addEventListener('click', captureFlow)
    document.getElementById('btn-recapture').addEventListener('click', captureFlow)

    document.getElementById('btn-cap-stop').addEventListener('click', stopCaptureStream)
    document.getElementById('btn-edit-stop').addEventListener('click', stopCaptureStream)

    document.getElementById('btn-copy').addEventListener('click', async () => {
      const btn = document.getElementById('btn-copy')
      try {
        await Capture.copyToClipboard()
        btn.textContent = '✓ COPIADO'
        setTimeout(() => { btn.textContent = '⧉ COPIAR' }, 1800)
      } catch (err) {
        alert('No se pudo copiar al portapapeles: ' + err.name)
      }
    })

    document.getElementById('btn-download-png').addEventListener('click', () => Capture.download())

    document.getElementById('btn-edit-close').addEventListener('click', () => {
      Capture.teardown()
      stopCaptureStream()
      showView('setup')
      setStatus('LISTO')
    })
  }

  // ── Atajos de teclado ──────────────────────────────────────────────────────
  const TOOL_KEYS = {
    b: 'pen', h: 'highlight', t: 'text', a: 'arrow',
    r: 'rect', e: 'ellipse', f: 'fill', p: 'pixelate', c: 'crop'
  }
  function wireKeyboardShortcuts () {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const key = e.key.toLowerCase()
      const inEditor = !document.getElementById('view-edit').hidden
      const inStudio = !document.getElementById('view-rec').hidden
      const inDone = !document.getElementById('view-done').hidden
      if (e.ctrlKey && key === 'z') {
        e.preventDefault()
        if (inEditor && editTools.api) { e.shiftKey ? editTools.api.redo() : editTools.api.undo() }
        else if (inStudio && recTools.api) { e.shiftKey ? recTools.api.redo() : recTools.api.undo() }
        return
      }
      if (key === 'escape') {
        if (inEditor) { Capture.teardown(); Capture.stopStream(); showView('setup'); setStatus('LISTO') }
        else if (inDone) document.getElementById('btn-again').click()
        return
      }
      if (TOOL_KEYS[key]) {
        const barId = inEditor ? 'edit-tools' : inStudio ? 'rec-tools' : null
        if (!barId) return
        const btn = document.getElementById(barId).querySelector(`[data-tool="${TOOL_KEYS[key]}"]`)
        if (btn) btn.click()
        return
      }
      if (key === ' ' && inStudio) {
        e.preventDefault()
        document.getElementById('btn-pause').click()
        return
      }
      if (key === '1' || key === '2' || key === '3') {
        const tabs = ['record', 'capture', 'dashboard']
        const btn = document.querySelector(`[data-tab="${tabs[parseInt(key) - 1]}"]`)
        if (btn) btn.click()
      }
    })
  }

  // Aviso si intenta cerrar la pestaña mientras graba
  window.addEventListener('beforeunload', (e) => {
    if (Recorder.isRecording()) { e.preventDefault(); e.returnValue = '' }
  })
  window.addEventListener('pagehide', () => {
    Devices.stopVuMeter()
    Capture.stopStream()
    Bubble.close()
    if (Recorder.isRecording()) Recorder.abort()
  })

  // ── Init ─────────────────────────────────────────────────────────────────

  loadPrefs()
  if (checkSupport()) {
    Bubble.init()
    recTools = wireToolbar('rec-tools')
    editTools = wireToolbar('edit-tools')
    Capture.init(editTools)
    wireOptions()
    wireRecordingControls()
    wireCaptureControls()
    wireKeyboardShortcuts()
    Devices.init()
  }
})()

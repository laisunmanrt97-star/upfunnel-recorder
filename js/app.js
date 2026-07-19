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
  let quality = 'native24'
  let camMode = 'embed'     // embed | off
  let camCorner = 'br'      // tl | tr | bl | br
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
    } catch {}
  }
  function savePrefs () {
    localStorage.setItem(PREF_KEY, JSON.stringify({ mainTab, mode, capMode, quality, camMode, camCorner }))
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
      b.style.background = ink
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
        document.getElementById('cam-embed-opts').style.opacity = camMode === 'embed' ? '1' : '0.35'
      })
    })
    document.getElementById('cam-embed-opts').style.opacity = camMode === 'embed' ? '1' : '0.35'

    document.querySelectorAll('.cam-corner').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.corner === camCorner)
      btn.addEventListener('click', () => {
        camCorner = btn.dataset.corner
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
      // Colocar canvas de anotaciones dentro del panel lateral
      annotate.id = 'rec-annotate'
      annotate.setAttribute('aria-label', 'Superficie de anotación en vivo')
      const wrap = document.getElementById('side-annotate-wrap')
      wrap.innerHTML = ''
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

    // ── Cámara mini overlay en el preview ──
    const camStream = Recorder.getCameraStream()
    const camPreview = document.getElementById('cam-preview')
    const camVideo = document.getElementById('cam-preview-video')
    if (camStream) {
      camVideo.srcObject = camStream
      camPreview.hidden = false
    } else {
      camPreview.hidden = true
    }
  }

  function teardownStudio () {
    stopMetricsInterval()
    const preview = document.getElementById('rec-preview')
    preview.srcObject = null
    document.getElementById('cam-preview').hidden = true
    document.getElementById('cam-preview-video').srcObject = null
    if (studioSurface) { studioSurface.destroy(); studioSurface = null }
    recTools.api = null
  }

  // ── Flujo de grabación ───────────────────────────────────────────────────

  async function startFlow () {
    // Se graba en memoria, al terminar se previsualiza y el usuario decide si descargar o grabar otro.
    // Sin diálogo de guardado previo: flujo rápido sin interrupciones.

    // 1. Abrir vista previa flotante de la cámara si corresponde
    // (Document Picture-in-Picture: se ve aunque cambies de ventana)
    if (camMode === 'embed' && !Bubble.isOpen()) {
      await Bubble.open().catch(() => {})
    }

    // 2. Compartir pantalla + (opcional) seleccionar área + preparar recorder
    setStatus('PREPARANDO…')
    Object.values(views).forEach(v => { v.hidden = true })   // deja lugar a view-area
    const camera = camMode === 'embed'
      ? { shape: Bubble.getShape(), size: Bubble.getSize(), corner: camCorner }
      : null
    let started
    try {
      started = await Recorder.start({ mode, quality, camera, onStop: onRecordingDone })
    } catch (err) {
      showView('setup')
      setStatus('LISTO')
      if (err.name !== 'NotAllowedError') {
        alert('No se pudo iniciar la grabación: ' + err.name)
        console.error('[SnapRec]', err)
      }
      return
    }
    if (!started) { showView('setup'); setStatus('LISTO'); return }   // canceló la selección de área

    // 3. Cuenta regresiva — el recorder ya corre, así que pausamos durante el 3-2-1
    Recorder.togglePause()
    Devices.stopVuMeter()
    await Tools.countdown(3)
    Recorder.togglePause()

    document.querySelector('.rec-topbar').classList.remove('paused')
    document.getElementById('btn-pause').textContent = '‖ PAUSAR'
    // Sincronizar título escrito antes de la cuenta regresiva
    const titleInput = document.getElementById('rec-title')
    Recorder.setTitle(titleInput.value)
    mountStudio()
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

    // Guardar metadatos en estadísticas
    const recMeta = Recorder.getInfo()
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
      document.querySelector('.done-controls').hidden = false
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

    document.getElementById('btn-stop').addEventListener('click', () => Recorder.stop())

    document.getElementById('btn-toggle-panel').addEventListener('click', () => {
      const studio = Recorder.getStudio()
      if (!studio) return
      const panel = document.getElementById('rec-sidepanel')
      const isCollapsed = panel.classList.toggle('collapsed')
      const btn = document.getElementById('btn-toggle-panel')
      if (studio.setAnnotationsEnabled) studio.setAnnotationsEnabled(isCollapsed)
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
      Devices.startVuMeter()
      setStatus('LISTO')
    })

    // Velocidad de reproducción
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed)
        const preview = document.getElementById('done-preview')
        preview.playbackRate = speed
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', b === btn))
      })
    })

    // Picture-in-Picture
    document.getElementById('btn-pip').addEventListener('click', async () => {
      const preview = document.getElementById('done-preview')
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture()
        } else {
          await preview.requestPictureInPicture()
        }
      } catch (err) {
        console.warn('[SnapRec] PiP:', err.name)
      }
    })
  }

  // ── Flujo de captura ─────────────────────────────────────────────────────

  async function captureFlow () {
    setStatus('CAPTURANDO…')
    Object.values(views).forEach(v => { v.hidden = true })
    let ok
    try {
      ok = await Capture.take(capMode)
    } catch (err) {
      showView('setup')
      setStatus('LISTO')
      if (err.name !== 'NotAllowedError') {
        alert('No se pudo capturar: ' + err.name)
        console.error('[SnapRec]', err)
      }
      return
    }
    if (ok) { showView('edit'); setStatus('EDITANDO') }
    else { showView('setup'); setStatus('LISTO') }
  }

  function wireCaptureControls () {
    document.getElementById('btn-capture').addEventListener('click', captureFlow)
    document.getElementById('btn-recapture').addEventListener('click', captureFlow)

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
      showView('setup')
      setStatus('LISTO')
    })
  }

  // Aviso si intenta cerrar la pestaña mientras graba
  window.addEventListener('beforeunload', (e) => {
    if (Recorder.isRecording()) { e.preventDefault(); e.returnValue = '' }
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
    Devices.init()
  }
})()

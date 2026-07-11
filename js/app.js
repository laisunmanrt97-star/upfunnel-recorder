// SnapRec — máquina de estados de la UI
// Estados: setup → (área) → countdown → grabando → resultado → setup

(() => {
  const views = {
    setup: document.getElementById('view-setup'),
    rec:   document.getElementById('view-rec'),
    done:  document.getElementById('view-done')
  }
  const headerStatus = document.getElementById('header-status')
  const countdownEl  = document.getElementById('countdown')
  const countdownNum = document.getElementById('countdown-num')

  let mode = 'full'         // full | area
  let quality = 'native24'
  let lastResult = null
  let lastObjectUrl = null

  const PREF_KEY = 'snaprec-opts'

  function loadPrefs () {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY)) || {}
      if (p.mode) mode = p.mode
      if (p.quality) quality = p.quality
    } catch {}
  }
  function savePrefs () {
    localStorage.setItem(PREF_KEY, JSON.stringify({ mode, quality }))
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
    }
    return ok
  }

  // ── Opciones (modo, calidad, burbuja) ────────────────────────────────────

  function wireOptions () {
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

    document.querySelectorAll('[data-quality]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.quality === quality)
      btn.addEventListener('click', () => {
        quality = btn.dataset.quality
        savePrefs()
        document.querySelectorAll('[data-quality]').forEach(b => b.classList.toggle('active', b === btn))
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

  // ── Flujo de grabación ───────────────────────────────────────────────────

  async function startFlow () {
    // 1. Elegir destino DENTRO del gesto de click
    const target = await Recorder.pickSaveTarget()
    if (target === 'cancelled') return

    // 2. Compartir pantalla + (opcional) seleccionar área + preparar recorder
    setStatus('PREPARANDO…')
    Object.values(views).forEach(v => { v.hidden = true })   // deja lugar a view-area
    let started
    try {
      started = await Recorder.start({ mode, quality, onStop: onRecordingDone })
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
    await countdown(3)
    Recorder.togglePause()

    document.querySelector('.rec-panel').classList.remove('paused')
    document.getElementById('btn-pause').textContent = '‖ PAUSAR'
    showView('rec')
    setStatus('GRABANDO')
  }

  function countdown (n) {
    return new Promise(resolve => {
      countdownEl.hidden = false
      countdownNum.textContent = n
      const iv = setInterval(() => {
        n--
        if (n <= 0) {
          clearInterval(iv)
          countdownEl.hidden = true
          resolve()
        } else {
          countdownNum.textContent = n
        }
      }, 1000)
    })
  }

  function onRecordingDone (result) {
    lastResult = result
    Bubble.close()

    const info = document.getElementById('done-info')
    const preview = document.getElementById('done-preview')
    const btnDownload = document.getElementById('btn-download')
    const mb = (result.bytes / 1_048_576).toFixed(1)

    if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null }

    if (result.saved === 'disk') {
      info.textContent = `Guardado directamente en tu PC: ${result.name} (${mb} MB)`
      btnDownload.hidden = true
      // Preview desde el archivo ya escrito
      result.handle.getFile().then(f => {
        lastObjectUrl = URL.createObjectURL(f)
        preview.src = lastObjectUrl
        preview.hidden = false
      }).catch(() => { preview.hidden = true })
    } else {
      info.textContent = `${result.name} (${mb} MB) — descárgalo con el botón`
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

    document.getElementById('btn-pause').addEventListener('click', () => {
      const state = Recorder.togglePause()
      document.getElementById('btn-pause').textContent = state === 'paused' ? '▶ REANUDAR' : '‖ PAUSAR'
      document.querySelector('.rec-panel').classList.toggle('paused', state === 'paused')
      setStatus(state === 'paused' ? 'EN PAUSA' : 'GRABANDO')
    })

    document.getElementById('btn-stop').addEventListener('click', () => Recorder.stop())

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
  }

  // Aviso si intenta cerrar la pestaña mientras graba
  window.addEventListener('beforeunload', (e) => {
    if (Recorder.isRecording()) { e.preventDefault(); e.returnValue = '' }
  })

  // ── Init ─────────────────────────────────────────────────────────────────

  loadPrefs()
  if (checkSupport()) {
    Bubble.init()
    wireOptions()
    wireRecordingControls()
    Devices.init()
  }
})()

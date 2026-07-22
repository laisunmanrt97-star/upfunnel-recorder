// SnapRec — selección de dispositivos (cámara y micrófono)
// Expone window.Devices

const Devices = (() => {
  const micSelect = document.getElementById('mic-select')
  const camSelect = document.getElementById('cam-select')
  const vuBar     = document.getElementById('vu-bar')
  const stMic     = document.getElementById('st-mic')
  const stCam     = document.getElementById('st-cam')
  const micTestBtn = document.getElementById('btn-mic-test')

  let micStream = null   // stream vivo del mic para el vúmetro (y reutilizado al grabar)
  let audioCtx  = null
  let vuRaf     = null
  let vuSource  = null
  let vuAnalyser = null

  const PREF_KEY = 'snaprec-devices'

  function loadPrefs () {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {} }
    catch { return {} }
  }
  function savePrefs () {
    localStorage.setItem(PREF_KEY, JSON.stringify({
      mic: micSelect.value,
      cam: camSelect.value
    }))
  }

  function fillSelect (select, devices, savedId) {
    select.replaceChildren()
    if (devices.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = '— no detectado —'
      select.appendChild(opt)
      return
    }
    for (const d of devices) {
      const opt = document.createElement('option')
      opt.value = d.deviceId
      opt.textContent = d.label || `Dispositivo ${select.length + 1}`
      select.appendChild(opt)
    }
    if (savedId && devices.some(d => d.deviceId === savedId)) select.value = savedId
  }

  async function refresh () {
    const prefs = loadPrefs()
    const all = await navigator.mediaDevices.enumerateDevices()
    fillSelect(micSelect, all.filter(d => d.kind === 'audioinput'), prefs.mic)
    fillSelect(camSelect, all.filter(d => d.kind === 'videoinput'), prefs.cam)
    updateStatusbar()
  }

  function updateStatusbar () {
    stMic.textContent = micSelect.selectedOptions[0]?.textContent.slice(0, 28) || '—'
    stCam.textContent = camSelect.selectedOptions[0]?.textContent.slice(0, 28) || '—'
  }

  // ── Vúmetro del micrófono ──────────────────────────────────────────────────

  async function startVuMeter () {
    stopVuMeter()
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: micSelect.value ? { deviceId: { exact: micSelect.value } } : true
      })
    } catch (err) {
      console.warn('[SnapRec] No se pudo abrir el micrófono:', err.name)
      updateMicTestButton(false)
      return
    }
    audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    vuSource = audioCtx.createMediaStreamSource(micStream)
    vuAnalyser = audioCtx.createAnalyser()
    vuAnalyser.fftSize = 256
    vuSource.connect(vuAnalyser)
    const data = new Uint8Array(vuAnalyser.frequencyBinCount)
    updateMicTestButton(true)

    function tick () {
      vuAnalyser.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i] - 128))
      }
      vuBar.style.width = Math.min(100, (peak / 128) * 160) + '%'
      vuRaf = requestAnimationFrame(tick)
    }
    tick()
  }

  function stopVuMeter () {
    if (vuRaf) { cancelAnimationFrame(vuRaf); vuRaf = null }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null }
    if (vuSource) { vuSource.disconnect(); vuSource = null }
    if (vuAnalyser) { vuAnalyser.disconnect(); vuAnalyser = null }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null }
    vuBar.style.width = '0%'
    updateMicTestButton(false)
  }

  function updateMicTestButton (active) {
    micTestBtn.textContent = active ? 'DETENER PRUEBA' : 'PROBAR MICRÓFONO'
    micTestBtn.classList.toggle('active', active)
    micTestBtn.setAttribute('aria-pressed', String(active))
  }

  // Devuelve un stream FRESCO del mic elegido (para grabar)
  async function getMicStream () {
    return navigator.mediaDevices.getUserMedia({
      audio: micSelect.value
        ? { deviceId: { exact: micSelect.value }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true }
    })
  }

  // Devuelve un stream de la cámara elegida (para la burbuja)
  async function getCamStream () {
    return navigator.mediaDevices.getUserMedia({
      video: camSelect.value
        ? { deviceId: { exact: camSelect.value }, width: { ideal: 640 }, height: { ideal: 480 } }
        : { width: { ideal: 640 }, height: { ideal: 480 } }
    })
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init () {
    await refresh()

    micTestBtn.addEventListener('click', () => {
      if (micStream) stopVuMeter()
      else startVuMeter()
    })
    micSelect.addEventListener('change', () => {
      const wasTesting = !!micStream
      savePrefs()
      updateStatusbar()
      if (wasTesting) startVuMeter()
    })
    camSelect.addEventListener('change', () => { savePrefs(); updateStatusbar(); Bubble.onCameraChange() })
    navigator.mediaDevices.addEventListener('devicechange', refresh)
  }

  return { init, getMicStream, getCamStream, startVuMeter, stopVuMeter }
})()

// SnapRec — selección de dispositivos (cámara y micrófono)
// Expone window.Devices

const Devices = (() => {
  const micSelect = document.getElementById('mic-select')
  const camSelect = document.getElementById('cam-select')
  const vuBar     = document.getElementById('vu-bar')
  const stMic     = document.getElementById('st-mic')
  const stCam     = document.getElementById('st-cam')

  let micStream = null   // stream vivo del mic para el vúmetro (y reutilizado al grabar)
  let audioCtx  = null
  let vuRaf     = null

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

  // Pide permiso una vez para que enumerateDevices devuelva labels reales
  async function requestPermission () {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => t.stop())
      return true
    } catch (err) {
      console.warn('[SnapRec] Permiso de micrófono denegado:', err.name)
      return false
    }
  }

  function fillSelect (select, devices, savedId) {
    select.innerHTML = ''
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
      return
    }
    audioCtx = audioCtx || new AudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const source   = audioCtx.createMediaStreamSource(micStream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    function tick () {
      analyser.getByteTimeDomainData(data)
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
    vuBar.style.width = '0%'
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
    const ok = await requestPermission()
    await refresh()
    if (ok) startVuMeter()

    micSelect.addEventListener('change', () => { savePrefs(); updateStatusbar(); startVuMeter() })
    camSelect.addEventListener('change', () => { savePrefs(); updateStatusbar(); Bubble.onCameraChange() })
    navigator.mediaDevices.addEventListener('devicechange', refresh)
  }

  return { init, getMicStream, getCamStream, startVuMeter, stopVuMeter }
})()

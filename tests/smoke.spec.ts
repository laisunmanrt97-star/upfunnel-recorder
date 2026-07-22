import { test, expect } from '@playwright/test'

test.describe.configure({ retries: 1 })

// ── Mock: streams sintéticos ───────────────────────────────────────────────────
// Intercepta getDisplayMedia y getUserMedia para no depender de hardware real.
// El canvas animado (640×360, colores cambiantes) sirve como fuente de video;
// un oscilador de 440 Hz como fuente de audio (no audible en headless).

async function setupMocks (context) {
  await context.addInitScript(() => {
    const origGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)

    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    let frame = 0
    function draw () {
      ctx.fillStyle = 'hsl(' + (frame % 360) + ', 70%, 50%)'
      ctx.fillRect(0, 0, 640, 360)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 48px sans-serif'
      ctx.fillText('FRAME ' + frame++, 200, 180)
      requestAnimationFrame(draw)
    }
    draw()

    function makeVideoTrack () {
      return canvas.captureStream(30).getVideoTracks()[0]
    }

    function makeAudioTrack () {
      try {
        const audioCtx = new AudioContext()
        const dst = audioCtx.createMediaStreamDestination()
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.frequency.value = 440
        gain.gain.value = 0.05
        osc.connect(gain).connect(dst)
        osc.start()
        if (audioCtx.state === 'suspended') audioCtx.resume()
        return dst.stream.getAudioTracks()[0]
      } catch {
        // fallback: track mudo
        return new MediaStream().getAudioTracks()[0]
      }
    }

    navigator.mediaDevices.getDisplayMedia = async () => {
      const videoTrack = makeVideoTrack()
      window.__lastDisplayTrack = videoTrack
      return new MediaStream([videoTrack, makeAudioTrack()])
    }

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__getUserMediaCalls = (window.__getUserMediaCalls || 0) + 1
      if (constraints && constraints.video) {
        return new MediaStream([makeVideoTrack()])
      }
      if (constraints && constraints.audio) {
        return new MediaStream([makeAudioTrack()])
      }
      return origGUM(constraints)
    }
  })
}

// ── TEST 1: Grabación ──────────────────────────────────────────────────────────

test('record 5s with synthetic streams → valid video file', async ({ page, context }) => {
  await setupMocks(context)

  await page.goto('/')
  await page.waitForSelector('#view-setup:not([hidden])')
  await page.waitForSelector('#btn-record:not([disabled])')

  await page.click('#btn-record')

  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
  await page.fill('#rec-title', 'Prueba de metadatos')
  await page.waitForTimeout(5000)

  await page.click('#btn-stop')

  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#btn-download')
  ])

  expect(download.suggestedFilename()).toMatch(/\.mp4$/)

  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const fileBuffer = Buffer.concat(chunks)
  expect(fileBuffer.length).toBeGreaterThan(1000)
  // El archivo debe ser MP4 real, no Matroska/WebM con extension cambiada.
  const sig = fileBuffer.subarray(4, 8).toString()
  expect(sig).toBe('ftyp')

  const metadata = await page.evaluate(async () => {
    const rows = await eval('Stats.getAll()')
    return rows[rows.length - 1]
  })
  expect(metadata.title).toBe('Prueba de metadatos')
  expect(metadata.width).toBe(640)
  expect(metadata.height).toBe(360)
  expect(metadata.codec).toMatch(/^video\/mp4/)
})

test('full recording composes live annotations into decoded video', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')
  await page.waitForSelector('#btn-record:not([disabled])')
  await page.click('#btn-record')
  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
  await expect.poll(() => page.evaluate(() => !!eval('Recorder.getStudio()?.annotationCanvas'))).toBe(true)

  await page.evaluate(() => {
    const canvas = eval('Recorder.getStudio().annotationCanvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(40, 40, 100, 100)
  })

  await expect.poll(async () => page.evaluate(() => {
    const video = document.getElementById('rec-preview') as HTMLVideoElement
    if (!video.videoWidth) return false
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const pixel = ctx.getImageData(80, 80, 1, 1).data
    return pixel[1] > 180 && pixel[0] < 100 && pixel[2] < 100
  }), { timeout: 5000 }).toBe(true)

  await page.waitForTimeout(4000)
  await page.click('#btn-stop')
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })

  const decoded = await page.evaluate(async () => {
    const source = (document.getElementById('done-preview') as HTMLVideoElement).src
    async function loadVideo () {
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      video.src = source
      document.body.appendChild(video)
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.addEventListener('error', () => reject(video.error), { once: true })
        video.load()
      })
      return video
    }

    let video
    try {
      video = await loadVideo()
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250))
      video = await loadVideo()
    }
    const target = Math.max(0, video.duration - 0.2)
    if (Math.abs(video.currentTime - target) > 0.01) {
      video.currentTime = target
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout seeking recorded video')), 5000)
        video.addEventListener('seeked', () => { clearTimeout(timeout); resolve() }, { once: true })
        video.addEventListener('error', () => { clearTimeout(timeout); reject(video.error) }, { once: true })
      })
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const result = {
      pixel: Array.from(ctx.getImageData(80, 80, 1, 1).data),
      duration: video.duration
    }
    video.remove()
    return result
  })
  const decodedPixel = decoded.pixel
  expect(Number.isFinite(decoded.duration)).toBe(true)
  expect(decoded.duration).toBeGreaterThan(0)
  expect(decoded.duration).toBeLessThan(60)
  expect(decodedPixel[1]).toBeGreaterThan(150)
  expect(decodedPixel[1]).toBeGreaterThan(decodedPixel[0] + 60)
  expect(decodedPixel[1]).toBeGreaterThan(decodedPixel[2] + 60)
})

test('double stop finalizes once and preserves the final chunk', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')
  await page.waitForSelector('#btn-record:not([disabled])')
  await page.click('#btn-record')
  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(1000)

  await page.evaluate(() => {
    eval('Recorder.stop()')
    eval('Recorder.stop()')
  })
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })

  const result = await page.evaluate(async () => {
    const rows = await eval('Stats.getAll()')
    const text = document.getElementById('done-info').textContent
    return { count: rows.length, size: rows[0]?.size || 0, text }
  })
  expect(result.count).toBe(1)
  expect(result.size).toBeGreaterThan(1000)
  expect(result.text).toContain('revísalo y descárgalo')
})

test('two recording cycles restore the annotation toolbar', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')

  for (let cycle = 0; cycle < 2; cycle++) {
    await page.waitForSelector('#btn-record:not([disabled])')
    await page.click('#btn-record')
    await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
    await expect.poll(() => page.evaluate(() => !!eval('Recorder.getStudio()?.annotationCanvas'))).toBe(true)
    await page.waitForTimeout(500)
    await page.click('#btn-stop')
    await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })
    await expect(page.locator('#rec-tools')).toHaveCount(1)

    if (cycle === 0) {
      await page.click('#btn-again')
      await page.waitForSelector('#view-setup:not([hidden])')
    }
  }
})

test('direct-to-disk recording writes chunks without retaining the final video in memory', async ({ page, context }) => {
  await setupMocks(context)
  await context.addInitScript(() => {
    window.__directWrites = 0
    window.showSaveFilePicker = async () => ({
      name: 'direct-test.mp4',
      createWritable: async () => ({
        write: async () => { window.__directWrites++ },
        close: async () => {},
        abort: async () => {}
      }),
      getFile: async () => new File([], 'direct-test.mp4', { type: 'video/mp4' })
    })
  })

  await page.goto('/')
  await page.check('#save-direct')
  await page.click('#btn-record')
  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(1500)
  await page.click('#btn-stop')
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })

  await expect(page.locator('#done-info')).toContainText('Guardado directamente')
  await expect(page.locator('#btn-download')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.__directWrites)).toBeGreaterThan(0)
})

test('embedded camera can move freely and persists its position', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')
  await page.waitForSelector('#btn-record:not([disabled])')
  await page.click('#btn-record')
  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })

  const positions = await page.evaluate(() => {
    const studio = eval('Recorder.getStudio()')
    const before = studio.getCameraRect()
    studio.setCameraPosition(24, 24)
    const after = studio.getCameraRect()
    const saved = JSON.parse(localStorage.getItem('snaprec-opts'))
    const pipSupported = 'documentPictureInPicture' in window
    const pipDocument = pipSupported ? eval('documentPictureInPicture.window?.document') : null
    const faithfulPreview = !pipSupported || !!pipDocument?.querySelector('video')
    return { before, after, saved: saved.camPosition, faithfulPreview }
  })

  expect(positions.before.x).toBeGreaterThan(positions.after.x)
  expect(positions.before.y).toBeGreaterThan(positions.after.y)
  expect(positions.after.x).toBe(24)
  expect(positions.after.y).toBe(24)
  expect(positions.saved.x).toBe(0)
  expect(positions.saved.y).toBe(0)
  expect(positions.faithfulPreview).toBe(true)

  await page.click('#btn-stop')
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })
})

// ── TEST 2: Modo captura ──────────────────────────────────────────────────────

test('capture mode → editor → copy to clipboard', async ({ page, context }) => {
  await setupMocks(context)

  await page.goto('/')
  await page.waitForSelector('#view-setup:not([hidden])')

  await page.click('[data-tab="capture"]')
  await page.waitForSelector('#setup-capture:not([hidden])')

  await page.click('#btn-capture')

  await page.waitForSelector('#view-edit:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(500)

  await page.click('#btn-copy')
  await page.waitForTimeout(200)

  // El botón debería mostrar "⧉ COPIAR" después del timeout de 1.8 s,
  // o "COPIADO" si el portapapeles funcionó
  await expect(page.locator('#btn-copy')).toBeVisible()

  await page.click('#btn-edit-close')
  await expect.poll(() => page.evaluate(() => window.__lastDisplayTrack?.readyState)).toBe('ended')
})

// ── TEST 3: Pestañas y navegación ─────────────────────────────────────────────

test('tabs: record / capture / dashboard switchean correctamente', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('#view-setup:not([hidden])')

  // Por defecto debe mostrar GRABAR
  await expect(page.locator('#setup-record')).toBeVisible()
  await expect(page.locator('#setup-capture')).toBeHidden()
  await expect(page.locator('#setup-dashboard')).toBeHidden()

  // Ir a CAPTURAR
  await page.click('[data-tab="capture"]')
  await expect(page.locator('#setup-capture')).toBeVisible()
  await expect(page.locator('#setup-record')).toBeHidden()
  await expect(page.locator('#setup-dashboard')).toBeHidden()

  // Ir a ESTADÍSTICAS
  await page.click('[data-tab="dashboard"]')
  await expect(page.locator('#setup-dashboard')).toBeVisible()
  await expect(page.locator('#setup-capture')).toBeHidden()

  // Volver a GRABAR
  await page.click('[data-tab="record"]')
  await expect(page.locator('#setup-record')).toBeVisible()
})

test('dashboard renders stored metadata as text, not executable HTML', async ({ page }) => {
  await page.goto('/')
  const payload = '<img src=x onerror="window.__snaprecXss=1">'
  await page.evaluate(async (title) => {
    await eval('Stats.save')({
      timestamp: Date.now(),
      duration: 1,
      size: 1,
      width: 640,
      height: 360,
      name: 'safe.mp4',
      title
    })
  }, payload)

  await page.click('[data-tab="dashboard"]')
  await expect(page.locator('#dash-table-body tr')).toHaveCount(1)
  await expect(page.locator('#dash-table-body img')).toHaveCount(0)
  await expect(page.locator('#dash-table-body td').nth(1)).toHaveAttribute('title', payload)
  await expect.poll(() => page.evaluate(() => window.__snaprecXss)).toBeUndefined()
})

test('microphone remains off until the user explicitly tests it', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => window.__getUserMediaCalls || 0)).toBe(0)
  await page.click('#btn-mic-test')
  await expect.poll(() => page.evaluate(() => window.__getUserMediaCalls || 0)).toBe(1)
  await expect(page.locator('#btn-mic-test')).toHaveAttribute('aria-pressed', 'true')

  await page.click('#btn-mic-test')
  await expect(page.locator('#btn-mic-test')).toHaveAttribute('aria-pressed', 'false')
})

test('statistics opt-out and retention are enforced at the storage boundary', async ({ page }) => {
  await page.goto('/')
  const now = Date.now()
  const result = await page.evaluate(async ({ now }) => {
    const stats = eval('Stats')
    await stats.clear()
    stats.setEnabled(true)
    await stats.setRetention('forever')
    await stats.save({ timestamp: now - 31 * 86_400_000, name: 'old.mp4' })
    await stats.save({ timestamp: now - 10 * 86_400_000, name: 'recent.mp4' })
    await stats.setRetention('30')
    const retained = await stats.getAll()
    stats.setEnabled(false)
    await stats.save({ timestamp: now, name: 'blocked.mp4' })
    const afterOptOut = await stats.getAll()
    return { retained: retained.map(r => r.name), afterOptOut: afterOptOut.map(r => r.name) }
  }, { now })

  expect(result.retained).toEqual(['recent.mp4'])
  expect(result.afterOptOut).toEqual(['recent.mp4'])
  await page.click('[data-tab="dashboard"]')
  await expect(page.locator('#dash-stats-enabled')).not.toBeChecked()
  await expect(page.locator('#dash-retention')).toHaveValue('30')
})

test('dashboard can remove one record and clear all local metadata', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const stats = eval('Stats')
    await stats.clear()
    stats.setEnabled(true)
    await stats.setRetention('forever')
    await stats.save({ timestamp: Date.now() - 1000, name: 'first.mp4' })
    await stats.save({ timestamp: Date.now(), name: 'second.mp4' })
  })
  await page.click('[data-tab="dashboard"]')
  await expect(page.locator('#dash-table-body tr')).toHaveCount(2)

  page.once('dialog', dialog => dialog.accept())
  await page.locator('#dash-table-body .row-delete').first().click()
  await expect(page.locator('#dash-table-body tr')).toHaveCount(1)

  page.once('dialog', dialog => dialog.accept())
  await page.click('#dash-clear-all')
  await expect(page.locator('#dash-table-body')).toContainText('Todavía no hay grabaciones')
  await expect.poll(() => page.evaluate(async () => (await eval('Stats.getAll()')).length)).toBe(0)
})

// ── TEST 4: Cambio de modo y calidad ──────────────────────────────────────────

test('modo y calidad persisten en localStorage', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForSelector('#view-setup:not([hidden])')

  // Cambiar a modo ÁREA
  await page.click('[data-mode="area"]')
  await expect(page.locator('#area-warning')).toBeVisible()

  // Cambiar calidad a LIGERA
  await page.click('[data-quality="light15"]')

  // Recargar — debe persistir (sin mock de getDisplayMedia, evitamos startFlow)
  await page.reload()
  await page.waitForSelector('#view-setup:not([hidden])')

  const areaBtn = page.locator('[data-mode="area"]')
  await expect(areaBtn).toHaveClass(/active/)
  await expect(page.locator('[data-quality="light15"]')).toHaveClass(/active/)
})

// ── TEST 5: Atajos de teclado en editor de captura ───────────────────────────

test('keyboard shortcuts: tool switching in capture editor', async ({ page, context }) => {
  await setupMocks(context)

  await page.goto('/')
  await page.waitForSelector('#view-setup:not([hidden])')

  // Ir a captura y tomar una
  await page.click('[data-tab="capture"]')
  await page.waitForSelector('#setup-capture:not([hidden])')
  await page.click('#btn-capture')
  await page.waitForSelector('#view-edit:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(500)

  // Probar cambio de herramientas por tecla
  const tests = [
    { key: 'a', tool: 'arrow' },
    { key: 'h', tool: 'highlight' },
    { key: 'r', tool: 'rect' },
    { key: 'e', tool: 'ellipse' },
    { key: 't', tool: 'text' },
    { key: 'b', tool: 'pen' },
    { key: 'f', tool: 'fill' },
    { key: 'p', tool: 'pixelate' },
    { key: 'c', tool: 'crop' },
  ]
  for (const { key, tool } of tests) {
    await page.keyboard.press(key)
    await expect(page.locator('#edit-tools [data-tool="' + tool + '"]')).toHaveClass(/active/)
  }
})

// ── TEST 6: Atajos de teclado — pestañas 1/2/3 ───────────────────────────────

test('keyboard shortcuts: tab switching with 1/2/3', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('#view-setup:not([hidden])')

  // 2 → captura
  await page.keyboard.press('2')
  await expect(page.locator('#setup-capture')).toBeVisible()

  // 3 → estadísticas
  await page.keyboard.press('3')
  await expect(page.locator('#setup-dashboard')).toBeVisible()

  // 1 → grabación
  await page.keyboard.press('1')
  await expect(page.locator('#setup-record')).toBeVisible()
})

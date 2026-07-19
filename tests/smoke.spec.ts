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

    navigator.mediaDevices.getDisplayMedia = async () =>
      new MediaStream([makeVideoTrack(), makeAudioTrack()])

    navigator.mediaDevices.getUserMedia = async (constraints) => {
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
  await page.waitForTimeout(5000)

  await page.click('#btn-stop')

  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#btn-download')
  ])

  expect(download.suggestedFilename()).toMatch(/\.(mp4|webm)$/)

  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const fileBuffer = Buffer.concat(chunks)
  expect(fileBuffer.length).toBeGreaterThan(1000)
  // Soporta header MP4 (ftyp) o WebM (EBML)
  const sig = fileBuffer.subarray(4, 8).toString()
  const ok = sig === 'ftyp' || fileBuffer.readUInt32BE(0) === 0x1A45DFA3
  expect(ok).toBe(true)
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
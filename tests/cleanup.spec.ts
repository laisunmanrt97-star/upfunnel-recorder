import { test, expect } from '@playwright/test'

test.describe.configure({ retries: 1 })

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

test('two recording cycles complete without page errors', async ({ page, context }) => {
  const errors = []
  page.on('pageerror', err => errors.push(err.message))

  await setupMocks(context)
  await page.goto('/')
  await page.waitForSelector('#btn-record:not([disabled])')

  for (let cycle = 0; cycle < 2; cycle++) {
    await page.click('#btn-record')
    await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
    await page.waitForTimeout(1000)
    await page.click('#btn-stop')
    await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })
    if (cycle === 0) {
      await page.click('#btn-again')
      await page.waitForSelector('#view-setup:not([hidden])')
    }
  }
  expect(errors).toEqual([])
})

test('composite canvas respects max resolution limit', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')
  await page.waitForSelector('#btn-record:not([disabled])')
  await page.click('#btn-record')
  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })

  const canvasSize = await page.evaluate(() => {
    const studio = eval('Recorder.getStudio()')
    return { width: studio.width, height: studio.height, pixels: studio.width * studio.height }
  })
  expect(canvasSize.pixels).toBeLessThanOrEqual(3700000)

  await page.click('#btn-stop')
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })
})

test('no dangling MediaStream sources after recording ends', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')
  await page.waitForSelector('#btn-record:not([disabled])')
  await page.click('#btn-record')
  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(1000)
  await page.click('#btn-stop')
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })

  const trackState = await page.evaluate(() => {
    return window.__lastDisplayTrack ? window.__lastDisplayTrack.readyState : 'no-track'
  })
  expect(trackState).toBe('ended')
})

test('Recorder.isRecording returns false and studio is null after stop', async ({ page, context }) => {
  await setupMocks(context)
  await page.goto('/')
  await page.waitForSelector('#btn-record:not([disabled])')
  await page.click('#btn-record')
  await page.waitForSelector('#view-rec:not([hidden])', { timeout: 20000 })
  await page.waitForTimeout(500)
  await page.click('#btn-stop')
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 15000 })

  const state = await page.evaluate(() => {
    return { recording: eval('Recorder.isRecording()'), studio: eval('Recorder.getStudio()') }
  })
  expect(state.recording).toBe(false)
  expect(state.studio).toBeNull()
})

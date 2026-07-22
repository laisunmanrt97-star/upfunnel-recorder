import { test, expect } from '@playwright/test'

test('strict CSP blocks HTML sinks and requires only same-origin resources', async ({ page }) => {
  const externalRequests = []
  const errors = []
  page.on('request', request => {
    if (new URL(request.url()).origin !== 'http://localhost:8080') externalRequests.push(request.url())
  })
  page.on('pageerror', error => errors.push(error.message))

  await page.goto('/')
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy).toContain("default-src 'self'")
  expect(policy).toContain("require-trusted-types-for 'script'")
  expect(policy).not.toContain('unsafe-inline')
  expect(policy).not.toMatch(/https?:\/\//)
  await expect(page.locator('[style]')).toHaveCount(0)
  expect(externalRequests).toEqual([])
  expect(errors).toEqual([])

  const blocked = await page.evaluate(() => {
    try {
      document.body.innerHTML = '<img src=x onerror=alert(1)>'
      return false
    } catch (error) {
      return error instanceof TypeError
    }
  })
  expect(blocked).toBe(true)
})

test('service worker is root-scoped and does not cache authenticated navigation', async ({ page }) => {
  await page.goto('/')
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => navigator.serviceWorker.controller?.state || '')
    } catch {
      return ''
    }
  }, { timeout: 15000 }).toBe('activated')
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    const cacheNames = await caches.keys()
    const workerSource = await fetch('/sw.js').then(response => response.text())
    return { scope: registration.scope, cacheNames, workerSource }
  })

  expect(state.scope).toBe('http://localhost:8080/')
  expect(state.cacheNames.every(name => name.startsWith('snaprec-'))).toBe(true)
  expect(state.workerSource).toContain("e.request.mode === 'navigate'")
  expect(state.workerSource).toContain('e.respondWith(fetch(e.request))')
  expect(state.workerSource).not.toContain("'/index.html'")
})

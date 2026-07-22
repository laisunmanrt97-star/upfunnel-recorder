if ('serviceWorker' in navigator) {
  const workerUrl = window.trustedTypes
    ? window.trustedTypes.createPolicy('snaprec-worker', {
        createScriptURL: value => value === '/sw.js' ? value : ''
      }).createScriptURL('/sw.js')
    : '/sw.js'
  let refreshingForUpdate = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshingForUpdate) return
    refreshingForUpdate = true
    location.reload()
  })
  navigator.serviceWorker.register(workerUrl, { scope: '/' })
    .then((registration) => registration.update())
    .catch(() => {})
}

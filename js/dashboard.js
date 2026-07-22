// SnapRec — Dashboard de estadísticas
// Expone window.Dashboard

const Dashboard = (() => {
  let chartInstance = null
  let initialized = false
  let activePeriod = 'month'

  // ── Helpers de fechas ──────────────────────────────────────────────────

  function periodPreset (key) {
    const now = Date.now()
    const day = 86_400_000
    switch (key) {
      case 'day':
        const today = new Date(); today.setHours(0,0,0,0)
        return { since: today.getTime(), until: now, label: 'Hoy' }
      case 'week':
        const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0)
        return { since: weekStart.getTime(), until: now, label: 'Esta semana' }
      case 'month':
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
        return { since: monthStart.getTime(), until: now, label: 'Este mes' }
      case 'year':
        const yearStart = new Date(); yearStart.setMonth(0,1); yearStart.setHours(0,0,0,0)
        return { since: yearStart.getTime(), until: now, label: 'Este año' }
      default:
        return null
    }
  }

  function fmtDate (ts) {
    const d = new Date(ts)
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  function fmtTime (ts) {
    return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  }

  function fmtDuration (sec) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  function fmtSize (bytes) {
    if (bytes < 1_048_576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1_048_576).toFixed(1) + ' MB'
  }

  // ── Montar dashboard ────────────────────────────────────────────────────

  async function mount (periodKey = 'month') {
    activePeriod = periodKey
    await Stats.pruneExpired()
    const period = periodPreset(periodKey)
    const [list, summ, dayData] = await Promise.all([
      Stats.latest(20),
      Stats.summary(period),
      Stats.byDay(period || { since: 0, until: Date.now() })
    ])

    renderKPIs(summ, period?.label || 'Todo')
    renderTable(list)
    renderChart(dayData, period?.label || 'Todo')
    await renderAllTimeCards()
    renderPreferences()
    highlightFilter(periodKey)
  }

  // ── KPIs ────────────────────────────────────────────────────────────────

  function renderKPIs (summ, label) {
    document.getElementById('dash-period-label').textContent = label
    document.getElementById('dash-count').textContent = summ.total
    document.getElementById('dash-duration').textContent = fmtDuration(summ.totalDuration)
    document.getElementById('dash-size').textContent = fmtSize(summ.totalSize)
    document.getElementById('dash-avg').textContent = summ.total ? fmtDuration(summ.avgDuration) : '—'
  }

  // ── Tabla de últimas grabaciones ────────────────────────────────────────

  function renderTable (list) {
    const tbody = document.getElementById('dash-table-body')
    tbody.replaceChildren()
    if (!list.length) {
      const row = tbody.insertRow()
      const cell = row.insertCell()
      cell.colSpan = 8
      cell.className = 'muted dash-empty'
      cell.textContent = 'Todavía no hay grabaciones.'
      return
    }
    for (const r of list) {
      const label = String(r.title && r.title !== r.name ? r.title : (r.name || ''))
      const values = [
        `${fmtDate(r.timestamp)} ${fmtTime(r.timestamp)}`,
        label.length > 30 ? label.slice(0, 30) + '…' : label,
        fmtDuration(r.duration),
        fmtSize(r.size),
        `${Number(r.width) || 0}×${Number(r.height) || 0}`,
        String(r.quality || '—'),
        r.camera === 'embed' ? '📷' : '—'
      ]
      const row = tbody.insertRow()
      values.forEach((value, index) => {
        const cell = row.insertCell()
        cell.textContent = value
        if (index === 1) cell.title = label
      })
      const actions = row.insertCell()
      const removeButton = document.createElement('button')
      removeButton.className = 'opt-btn danger row-delete'
      removeButton.textContent = 'BORRAR'
      removeButton.setAttribute('aria-label', `Borrar ${label || 'grabación'}`)
      removeButton.addEventListener('click', async () => {
        if (!confirm('¿Borrar estos metadatos del historial local?')) return
        removeButton.disabled = true
        await Stats.remove(r.id)
        await mount(activePeriod)
      })
      actions.appendChild(removeButton)
    }
  }

  function showChartFallback (msg) {
    const canvas = document.getElementById('dash-chart')
    const fallback = document.getElementById('dash-chart-fallback')
    canvas.hidden = true
    fallback.hidden = false
    fallback.textContent = msg
  }

  function renderChartFallback (ctx, msg) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.fillStyle = '#94A3B8'
    ctx.font = '14px Inter, Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(msg, ctx.canvas.width / 2, ctx.canvas.height / 2)
  }

  // ── Gráfica de barras (grabaciones por día) ─────────────────────────────

  function renderChart (dayMap, label) {
    const canvas = document.getElementById('dash-chart')
    const ctx = canvas.getContext('2d')
    const fallback = document.getElementById('dash-chart-fallback')
    canvas.hidden = false
    if (fallback) fallback.hidden = true

    if (chartInstance) { chartInstance.destroy(); chartInstance = null }

    const days = Object.keys(dayMap).sort()
    if (!days.length) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#94A3B8'
      ctx.font = '14px Segoe UI, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Sin datos en este período', canvas.width / 2, canvas.height / 2)
      return
    }

    const counts = days.map(d => dayMap[d].count)
    const durations = days.map(d => Math.round(dayMap[d].totalDuration / 60)) // minutos

    try {
      if (typeof Chart !== 'undefined') {
        chartInstance = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: days.map(d => d.slice(5)),
            datasets: [
              {
                label: 'Grabaciones',
                data: counts,
                backgroundColor: 'rgba(0, 229, 255, 0.7)',
                borderColor: '#00E5FF',
                borderWidth: 1,
                borderRadius: 4,
                yAxisID: 'y'
              },
              {
                label: 'Minutos',
                data: durations,
                backgroundColor: 'rgba(148, 163, 184, 0.5)',
                borderColor: '#94A3B8',
                borderWidth: 1,
                borderRadius: 4,
                yAxisID: 'y1'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                labels: { color: '#94A3B8', font: { family: 'Segoe UI' } }
              },
              tooltip: {
                backgroundColor: '#080C14',
                borderColor: 'rgba(148,163,184,0.25)',
                borderWidth: 1,
                titleColor: '#FFFFFF',
                bodyColor: '#94A3B8',
                callbacks: {
                  label: (ctx) => {
                    if (ctx.dataset.label === 'Minutos') return `${ctx.raw} min`
                    return `${ctx.raw} grabaciones`
                  }
                }
              }
            },
            scales: {
              x: {
                ticks: { color: '#94A3B8', font: { size: 10, family: 'Segoe UI' } },
                grid: { color: 'rgba(148,163,184,0.1)' }
              },
              y: {
                beginAtZero: true,
                ticks: { color: '#94A3B8', font: { size: 10, family: 'Segoe UI' }, stepSize: 1 },
                grid: { color: 'rgba(148,163,184,0.1)' }
              },
              y1: {
                beginAtZero: true,
                position: 'right',
                ticks: { color: '#94A3B8', font: { size: 10, family: 'Segoe UI' } },
                grid: { display: false }
              }
            }
          }
        })
      } else {
        showChartFallback('Chart.js no está disponible')
      }
    } catch (err) {
      showChartFallback('Gráfica no disponible')
    }
  }

  // ── Cards de "todos los tiempos" ───────────────────────────────────────

  async function renderAllTimeCards () {
    const now = Date.now()
    const day = 86_400_000

    const periods = [
      { label: 'Último mes', since: now - 30 * day, until: now },
      { label: 'Últimos 3 meses', since: now - 90 * day, until: now },
      { label: 'Último año', since: now - 365 * day, until: now },
      { label: 'Todos los tiempos', since: null, until: null }
    ]

    const container = document.getElementById('dash-period-cards')
    const summaries = await Promise.all(periods.map(async (p) => {
      const data = await Stats.summary(p.since ? p : null)
      return { period: p, data }
    }))
    container.replaceChildren()
    for (const { period, data } of summaries) {
      const card = document.createElement('div')
      card.className = 'stat-card'
      const label = document.createElement('span')
      label.className = 'stat-card-label'
      label.textContent = period.label
      const value = document.createElement('span')
      value.className = 'stat-card-value'
      value.textContent = data.total
      const detail = document.createElement('span')
      detail.className = 'stat-card-sub'
      detail.textContent = `${fmtDuration(data.totalDuration)} · ${fmtSize(data.totalSize)}`
      card.append(label, value, detail)
      container.appendChild(card)
    }
  }

  function renderPreferences () {
    const preferences = Stats.getPreferences()
    document.getElementById('dash-stats-enabled').checked = preferences.enabled
    document.getElementById('dash-retention').value = preferences.retention
  }

  // ── Resaltar filtro activo ─────────────────────────────────────────────

  function highlightFilter (key) {
    document.querySelectorAll('.dash-filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.period === key)
    })
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function init () {
    if (!initialized) {
      initialized = true
      document.querySelectorAll('.dash-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => mount(btn.dataset.period).catch(console.error))
      })
      document.getElementById('dash-stats-enabled').addEventListener('change', (event) => {
        Stats.setEnabled(event.target.checked)
        renderPreferences()
      })
      document.getElementById('dash-retention').addEventListener('change', async (event) => {
        await Stats.setRetention(event.target.value)
        await mount(activePeriod)
      })
      document.getElementById('dash-clear-all').addEventListener('click', async () => {
        if (!confirm('¿Borrar todo el historial local? Esta acción no se puede deshacer.')) return
        await Stats.clear()
        await mount(activePeriod)
      })
    }
    mount(activePeriod).catch(console.error)
  }

  return { init, mount }
})()

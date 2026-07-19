// SnapRec — Dashboard de estadísticas
// Expone window.Dashboard

const Dashboard = (() => {
  let chartInstance = null

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
    const period = periodPreset(periodKey)
    const [list, summ, dayData] = await Promise.all([
      Stats.latest(20),
      Stats.summary(period),
      Stats.byDay(period || { since: 0, until: Date.now() })
    ])

    renderKPIs(summ, period?.label || 'Todo')
    renderTable(list)
    renderChart(dayData, period?.label || 'Todo')
    renderAllTimeCards()
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
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">Todavía no hay grabaciones.</td></tr>'
      return
    }
    tbody.innerHTML = list.map(r => `
      <tr>
        <td>${fmtDate(r.timestamp)} ${fmtTime(r.timestamp)}</td>
        <td>${fmtDuration(r.duration)}</td>
        <td>${fmtSize(r.size)}</td>
        <td>${r.width}×${r.height}</td>
        <td>${r.quality || '—'}</td>
        <td>${r.camera === 'embed' ? '📷' : '—'}</td>
      </tr>
    `).join('')
  }

  // ── Gráfica de barras (grabaciones por día) ─────────────────────────────

  function renderChart (dayMap, label) {
    const canvas = document.getElementById('dash-chart')
    const ctx = canvas.getContext('2d')

    if (chartInstance) { chartInstance.destroy(); chartInstance = null }

    const days = Object.keys(dayMap).sort()
    if (!days.length) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#94A3B8'
      ctx.font = '14px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Sin datos en este período', canvas.width / 2, canvas.height / 2)
      return
    }

    const counts = days.map(d => dayMap[d].count)
    const durations = days.map(d => Math.round(dayMap[d].totalDuration / 60)) // minutos

    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: days.map(d => d.slice(5)), // MM-DD
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
            labels: { color: '#94A3B8', font: { family: 'Inter' } }
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
            ticks: { color: '#94A3B8', font: { size: 10, family: 'Inter' } },
            grid: { color: 'rgba(148,163,184,0.1)' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#94A3B8', font: { size: 10, family: 'Inter' }, stepSize: 1 },
            grid: { color: 'rgba(148,163,184,0.1)' }
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            ticks: { color: '#94A3B8', font: { size: 10, family: 'Inter' } },
            grid: { display: false }
          }
        }
      }
    })
  }

  // ── Cards de "todos los tiempos" ───────────────────────────────────────

  async function renderAllTimeCards () {
    const all = await Stats.getAll()
    const now = Date.now()
    const day = 86_400_000

    const periods = [
      { label: 'Último mes', since: now - 30 * day, until: now },
      { label: 'Últimos 3 meses', since: now - 90 * day, until: now },
      { label: 'Último año', since: now - 365 * day, until: now },
      { label: 'Todos los tiempos', since: null, until: null }
    ]

    const container = document.getElementById('dash-period-cards')
    const cards = await Promise.all(periods.map(async (p) => {
      const data = await Stats.summary(p.since ? p : null)
      return `
        <div class="stat-card">
          <span class="stat-card-label">${p.label}</span>
          <span class="stat-card-value">${data.total}</span>
          <span class="stat-card-sub">${fmtDuration(data.totalDuration)} · ${fmtSize(data.totalSize)}</span>
        </div>`
    }))
    container.innerHTML = cards.join('')
  }

  // ── Resaltar filtro activo ─────────────────────────────────────────────

  function highlightFilter (key) {
    document.querySelectorAll('.dash-filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.period === key)
    })
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function init () {
    // Wire filters
    document.querySelectorAll('.dash-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        mount(btn.dataset.period)
      })
    })
    mount('month')
  }

  return { init, mount }
})()

# SnapRec — Bitácora de desarrollo

> Última actualización: 2026-07-22
> Versión: 1.3.0
> Stack: HTML + CSS + JS vanilla (sin frameworks ni build) · APIs web de captura · nginx en VPS

---

## Qué es SnapRec

Grabador de pantalla **web** para hacer videotutoriales sin congelar el PC (OBS no corre bien en esta máquina: i5-6300U 2 núcleos, 6 GB RAM). Vive en el VPS con HTTPS y clave; se abre en Chrome y graba:

- **Pantalla** (completa o área seleccionada)
- **Cámara USB** incrustada limpia dentro del video (círculo o rectángulo, esquina configurable, arrastrable en vivo)
- **Micrófono** (inalámbrico o cualquier input), mezclado con el audio del sistema si se comparte

El video se mantiene en memoria hasta que el usuario lo descarga como `.mp4`, o se escribe directo a disco para grabaciones largas. Un solo usuario, protegido con basic auth de nginx.

Hermano de SnapEdit. Ambos usan el **ADN visual Upfunnel**: Jet Black `#080C14`, Cyan Blue `#00E5FF`, Pure White, Slate Mist `#94A3B8`, tipografía Inter autoalojada, glow cian sutil, logo oficial en el header.

---

## Estructura

```
snaprec/
├── index.html            ← shell: setup / estudio / editor / resultado / dashboard
├── style.css             ← design system Upfunnel + prefers-reduced-motion
├── manifest.json         ← PWA manifest (standalone, icons SVG)
├── sw.js                 ← service worker (cache v8, navegación por red)
├── assets/
│   ├── icon-192.svg      ← icono PWA 192px
│   ├── icon-512.svg      ← icono PWA 512px
│   ├── upfunnel-logo-horizontal-blanco-transparente.png
│   ├── chart.umd.min.js  ← Chart.js autoalojado
│   └── Inter-variable.woff2 ← Inter autoalojada
├── js/
│   ├── app.js            ← máquina de estados, wiring de UI, atajos de teclado
│   ├── devices.js        ← selección de cámara/mic, vúmetro, persistencia
│   ├── recorder.js       ← getDisplayMedia + mezcla de audio + MediaRecorder + guardado
│   ├── bubble.js         ← vista previa de cámara (Document PiP, formas y tamaños)
│   ├── crop.js           ← modo área: frame congelado + selección + canvas.captureStream
│   ├── capture.js        ← modo captura: stream vivo, countdown, editor
│   ├── tools.js          ← herramientas de dibujo (pen, highlight, arrow, rect, ellipse, text, fill, pixelate, crop)
│   ├── stats.js          ← IndexedDB: metadatos con retención configurable
│   ├── dashboard.js      ← visualización: KPIs, gráfica Chart.js, tabla, filtros
│   └── sw-register.js    ← registro del service worker con Trusted Types
├── deploy/
│   └── nginx.conf.example  ← bloque nginx con CSP, HSTS, Basic Auth
└── tests/
    ├── smoke.spec.ts     ← 15 tests de integración (grabación, captura, stats, atajos)
    └── security.spec.ts  ← 2 tests de seguridad (CSP, service worker)
```

---

## Estado de fases (PLAN_DE_ACCION.md)

| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Integridad del núcleo (compositor Canvas siempre, finalización idempotente, limpieza de dispositivos) | ✅ |
| 2 | PiP y ciclos repetidos (restaurar canvas/overlay/toolbar, limpiar listeners, dos grabaciones sin recargar) | ✅ |
| 3 | Grabaciones largas (modo Normal/Larga, showSaveFilePicker, escritura serial de chunks, aborto seguro) | ✅ |
| 4 | Memoria y rendimiento (bitrate dinámico, presupuesto de snapshots por resolución, limpieza de streams, botón detener captura) | ✅ |
| 5 | Estadísticas (filtros por período, zona horaria local, escaneo por índice, renderizado como texto, Chart.js opcional) | ✅ |
| 6 | PWA y seguridad (CSP completo, Inter autoalojada, service worker v8, cabeceras nginx, manifest) | ✅ |
| 7 | Accesibilidad (ARIA en tabs/selectores, regiones vivas en countdown y estado, prefers-reduced-motion, fallback de gráfica) | ✅ |
| 8 | Pruebas y documentación (17 tests automatizados, PROGRESO.md actualizado, desktop.ini ignorado) | ✅ |

---

## Features implementadas

### v1.3.0 (2026-07-22)
- **Fases 3-8 completadas**: grabaciones largas con escritura directa a disco, optimizaciones de memoria, estadísticas con Chart.js autoalojado, PWA con Inter autoalojada y CSP completo, accesibilidad ARIA/live regions/reduced-motion, 17 tests automatizados.
- **Dashboard de estadísticas** con KPIs, gráfica de barras por día, tabla de últimas grabaciones, filtros (hoy/semana/mes/año/todo), retención configurable y opt-out de privacidad.
- **Atajos de teclado**: herramientas (B/H/T/A/R/E/F/P/C), Ctrl+Z deshacer, Ctrl+Shift+Z rehacer, espacio pausar/reanudar, 1/2/3 cambiar pestañas, ESC cerrar editor.
- **Service worker** con precache de assets, navegación por red (compatible con Basic Auth), Trusted Types, actualización automática.
- **Burbuja/cámara incrustada**: composición limpia dentro del video (círculo o rectángulo), sin chrome de ventana, arrastrable en vivo, esquina configurable, persistencia en localStorage.

### v1.2 — Estudio de anotación + modo captura (2026-07-11)
- **Anotación en vivo**: pipeline por canvas compone pantalla + anotaciones + cámara; toolbar completa (dibujo, resaltador, flecha, rect, elipse, texto, 6 tintas, undo/clear); pausa para dibujar con calma.
- **Modo CAPTURA**: stream reutilizable entre capturas, countdown 3s, editor con censura, pixelado y recorte, copia al portapapeles o PNG.
- **tools.js**: módulo compartido de dibujo portado de SnapEdit.

### v1.1 — Cámara incrustada + PiP
- Cámara compositada dentro del video (no más ventana PiP con chrome).
- Document Picture-in-Picture como vista previa opcional.
- Grabación de área con canvas.captureStream.

### v1.0 — Fundación
- Grabación pantalla completa + área con selección.
- Mezcla de audio (mic + sistema).
- Guardado en memoria con descarga al final.
- ADN visual Upfunnel.

---

## Decisiones técnicas clave

- **Web y no escritorio**: Chrome ya está corriendo (no suma RAM) y MediaRecorder es más liviano que OBS.
- **Codec y contenedor**: MP4 nativo con H.264/AAC (`avc1` + `mp4a`). Sin fallback WebM porque Chromium genera Matroska no interoperable.
- **Compositor Canvas SIEMPRE**: todas las grabaciones pasan por canvas para garantizar anotaciones en el video, independientemente del modo o cámara.
- **Dos modos de guardado**: memoria (revisión previa, hasta 30 min) y directo a disco (RAM plana, sin límite).
- **Bitrate dinámico**: escala según píxeles de salida respecto a 720p, con tope de 4 Mbps.
- **Countdown**: recorder arranca y se pausa durante 3-2-1, no se pierde contenido.
- **Sin backend**: sitio estático puro, videos nunca tocan el servidor.

## Requisitos de navegador

- Chrome/Edge ≥116 (Document PiP; grabación funciona desde versiones anteriores)
- HTTPS obligatorio (o `localhost` para desarrollo)

---

## Pruebas

```bash
npm test                    # 17 tests (15 smoke + 2 seguridad)
npx playwright test tests/smoke.spec.ts -g "record 5s"
```

Cobertura: grabación + anotaciones en video, doble stop, ciclos consecutivos, guardado directo, cámara arrastrable, captura+editor, tabs, dashboard XSS, micrófono, opt-out/retention, persistencia, atajos de teclado, CSP, service worker.

---

## Cómo probar en local

```powershell
cd C:\Users\GABRIEL\Desktop\Proyecto KeySafe\snaprec
npx serve .   # o: npm run dev
# abrir http://localhost:8080 en Chrome
```

## Cómo desplegar al VPS

Ver `deploy/nginx.conf.example` — copiar archivos a `/var/www/snaprec`, crear `.htpasswd`, incluir el bloque `location` y recargar nginx.

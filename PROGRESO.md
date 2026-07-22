# SnapRec — Bitácora de desarrollo

> Última actualización: 2026-07-10
> Stack: HTML + CSS + JS vanilla (sin frameworks ni build) · APIs web de captura · nginx en VPS

---

## Qué es SnapRec

Grabador de pantalla **web** para hacer videotutoriales sin congelar el PC (OBS no corre bien en esta máquina: i5-6300U 2 núcleos, 6 GB RAM). Vive en el VPS con HTTPS y clave; se abre en Chrome y graba:

- **Pantalla** (completa o área seleccionada)
- **Cámara USB** como burbuja flotante estilo Loom (Document Picture-in-Picture — siempre visible, queda grabada dentro del video, costo de CPU cero)
- **Micrófono** (inalámbrico o cualquier input), mezclado con el audio del sistema si se comparte

El video se mantiene en memoria hasta que el usuario lo descarga como `.mp4`. El modo de escritura directa para grabaciones largas permanece en el plan de acción. Un solo usuario, protegido con basic auth de nginx.

Hermano de SnapEdit. Desde 2026-07-11 ambos usan el **ADN visual Upfunnel**: Jet Black `#080C14`, Cyan Blue `#00E5FF`, Pure White, Slate Mist `#94A3B8`, tipografía Inter, glow cian sutil, logo oficial en el header (`assets/upfunnel-logo-horizontal-blanco-transparente.png`, mín. 152 px de ancho, nunca recrearlo).

---

## Estructura

```
snaprec/
├── index.html          ← vistas: setup / selección de área / grabando / resultado
├── style.css           ← design system SnapEdit
├── js/
│   ├── app.js          ← máquina de estados, countdown, wiring de la UI
│   ├── devices.js      ← selección de cámara/mic, vúmetro, persistencia
│   ├── recorder.js     ← getDisplayMedia + mezcla de audio + MediaRecorder + guardado
│   ├── bubble.js       ← burbuja de cámara (Document PiP, formas y tamaños)
│   └── crop.js         ← modo área: frame congelado + selección + canvas.captureStream
├── deploy/
│   └── nginx.conf.example  ← bloque nginx con basic auth (2 opciones: ruta o subdominio)
└── PROGRESO.md
```

---

## Fases

| # | Contenido | Estado |
|---|-----------|--------|
| F1 | Esqueleto + selección de dispositivos + vúmetro | ✅ Código listo |
| F2 | Grabación pantalla completa + guardado streaming | ✅ Código listo |
| F3 | Burbuja de cámara (Document PiP) | ✅ Código listo |
| F4 | Grabación de área (canvas crop) | ✅ Código listo |
| F5 | Deploy al VPS | 🔶 En proceso — Coolify de Gabriel, rama `main` lista |
| F6 | Prueba real (tutorial de ~2 min con cámara + mic) | ⬜ Pendiente — la hace Gabriel en su Chrome |
| F7 | Anotación en vivo al grabar (flechas, texto, resaltado…) | ✅ Código listo (2026-07-11) |
| F8 | Modo CAPTURA con editor completo estilo SnapEdit | ✅ Código listo (2026-07-11) |

### v1.2 — Estudio de anotación + modo captura (2026-07-11)

- **Anotación en vivo**: el pipeline por canvas ahora corre SIEMPRE al grabar e incluye una capa de anotaciones entre la pantalla y la cámara. La vista de grabación es un "estudio": preview en vivo del video compuesto + toolbar (dibujo, resaltador, flecha, rect, elipse, texto, 6 tintas, grosor, deshacer, limpiar). Lo que dibujas queda grabado al instante. Pausar permite dibujar con calma y reanudar (las anotaciones persisten hasta LIMPIAR).
- **Limitación del espejo**: si grabas la pantalla completa donde está SnapRec, al volver a la pestaña a dibujar, el video muestra SnapRec. Mitigación documentada en la UI: compartir una VENTANA para señalar en vivo, o pausar→dibujar→reanudar en pantalla completa. Solución de fondo (v2) sería overlay nativo en escritorio.
- **Modo CAPTURA**: pestaña nueva junto a GRABAR. Flujo: compartir pantalla/ventana (una vez, el stream queda vivo entre capturas) → countdown 3s para cambiar a la app objetivo → beep + título de pestaña avisan → editor con todas las herramientas de SnapEdit (incluye censura, pixelado y recorte) → COPIAR al portapapeles o descargar PNG.
- **tools.js**: módulo compartido de dibujo (portado de SnapEdit) usado por el estudio y el editor; undo/redo por snapshots, texto con input flotante, countdown reutilizable.
- **Verificado** con streams sintéticos: el video grabado contiene pantalla + anotaciones (flecha cian, trazo rojo) + cámara, cada capa en su posición esperada.

---

## Decisiones técnicas clave

- **Web y no escritorio**: elegido por el usuario; Chrome ya está corriendo (no suma RAM) y el pipeline nativo de MediaRecorder es mucho más liviano que OBS.
- **Codec y contenedor (2026-07-21)**: salida MP4 nativa con H.264/AAC (`avc1` + `mp4a`). Se eliminó el fallback H.264/Opus dentro de WebM porque Chromium generaba Matroska no interoperable. Si MP4 no está disponible, se solicita actualizar Chrome/Edge.
- **Flujo de guardado (decisión de producto, 2026-07-11)**: se graba en memoria y **al terminar** el usuario revisa el video y decide si lo descarga — sin diálogo de guardado antes de grabar; si no descarga, no se guarda. Trade-off asumido: la RAM crece con la duración (~19 MB/min con el preset nativo). El guardado en streaming a disco (`Recorder.pickSaveTarget` + File System Access, chunks escritos directo al archivo) **sigue implementado y probado** — se reactivará más adelante, idealmente como opción "grabación larga". Nota técnica de la versión original: `showSaveFilePicker` debe llamarse DENTRO del click (la activación de usuario expira tras awaits largos).
- **Countdown sin grabar basura**: el recorder arranca, se pausa durante el 3-2-1 y se reanuda al llegar a 0.
- **Cámara incrustada (2026-07-11)**: la ventana Document PiP trae chrome de Chrome (barra de título "localhost", controles al hover) que salía grabado — rechazado por el usuario. Ahora la cámara se **composita dentro del video** vía el pipeline de canvas (círculo o rectángulo limpio con borde cian, esquina configurable ↖↗↙↘, tamaños S/M/L). La ventana PiP quedó como **vista previa** para encuadrarse antes de grabar: se cierra sola al iniciar (si quedara abierta saldría duplicada en el video). Verificado end-to-end con streams sintéticos: píxel de cámara en la esquina correcta del video resultante.
- **Costo del compositor**: con cámara incrustada (o modo área) el video pasa por canvas → más CPU que la captura directa. Si el PC sufre: preset LIGERA 15fps. Sin cámara y pantalla completa sigue siendo captura directa (0 CPU extra).
- **Burbuja/vista previa**: se abre con su propio botón (gesto de usuario propio — Document PiP lo exige). Al cambiar cámara/forma/tamaño con la vista previa abierta, se reabre.
- **Modo área**: única parte que re-encodea vía canvas (más CPU). Advertencia visible en la UI. Dimensiones del recorte forzadas a pares (requisito de algunos encoders).
- **Botón nativo "Dejar de compartir"** de Chrome = stop (listener en `ended` del video track).

## Requisitos de navegador

- Chrome/Edge ≥116 (Document PiP para la burbuja; el resto funciona desde versiones anteriores)
- HTTPS obligatorio (o `localhost` para desarrollo)

---

## Roadmap (fuera de v1, por decisión del usuario)

- Subida de videos al VPS con link para compartir con la comunidad
- Remultiplexado o conversión server-side como respaldo para navegadores sin MP4 nativo
- Edición/anotación post-grabación (posible puente con SnapEdit)
- Multiusuario

---

## Cómo probar en local

```powershell
cd C:\Users\GABRIEL\Desktop\screenshots\snaprec
# cualquier servidor estático en localhost sirve (contexto seguro sin HTTPS):
npx serve .   # o: python -m http.server 8080
# abrir http://localhost:8080 en Chrome
```

## Cómo desplegar al VPS

Ver `deploy/nginx.conf.example` — copiar archivos a `/var/www/snaprec`, crear `.htpasswd`, incluir el bloque `location` y recargar nginx.

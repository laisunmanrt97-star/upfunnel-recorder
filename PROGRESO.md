# SnapRec — Bitácora de desarrollo

> Última actualización: 2026-07-10
> Stack: HTML + CSS + JS vanilla (sin frameworks ni build) · APIs web de captura · nginx en VPS

---

## Qué es SnapRec

Grabador de pantalla **web** para hacer videotutoriales sin congelar el PC (OBS no corre bien en esta máquina: i5-6300U 2 núcleos, 6 GB RAM). Vive en el VPS con HTTPS y clave; se abre en Chrome y graba:

- **Pantalla** (completa o área seleccionada)
- **Cámara USB** como burbuja flotante estilo Loom (Document Picture-in-Picture — siempre visible, queda grabada dentro del video, costo de CPU cero)
- **Micrófono** (inalámbrico o cualquier input), mezclado con el audio del sistema si se comparte

El video se guarda **directo al disco del PC** (File System Access API — la RAM no crece con la duración) como `.webm`. Un solo usuario, protegido con basic auth de nginx.

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
| F5 | Deploy al VPS (nginx + basic auth) | ⬜ Pendiente — necesita acceso/datos del VPS |
| F6 | Prueba real (tutorial de ~2 min con cámara + mic) | ⬜ Pendiente — la hace Gabriel en su Chrome |

---

## Decisiones técnicas clave

- **Web y no escritorio**: elegido por el usuario; Chrome ya está corriendo (no suma RAM) y el pipeline nativo de MediaRecorder es mucho más liviano que OBS.
- **Codec**: se intenta `h264` (encode por hardware si el navegador lo da), luego `vp8`. Salida `.webm` — YouTube lo acepta directo.
- **Guardado en streaming**: `showSaveFilePicker` se llama DENTRO del click (la activación de usuario expira tras awaits largos); los chunks de MediaRecorder (1/segundo) se escriben directo al archivo. Fallback a Blob en memoria si el navegador no soporta la API.
- **Countdown sin grabar basura**: el recorder arranca, se pausa durante el 3-2-1 y se reanuda al llegar a 0.
- **Cámara incrustada (2026-07-11)**: la ventana Document PiP trae chrome de Chrome (barra de título "localhost", controles al hover) que salía grabado — rechazado por el usuario. Ahora la cámara se **composita dentro del video** vía el pipeline de canvas (círculo o rectángulo limpio con borde cian, esquina configurable ↖↗↙↘, tamaños S/M/L). La ventana PiP quedó como **vista previa** para encuadrarse antes de grabar: se cierra sola al iniciar (si quedara abierta saldría duplicada en el video). Verificado end-to-end con streams sintéticos: píxel de cámara en la esquina correcta del webm resultante.
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
- Conversión a MP4 server-side (ffmpeg en el VPS)
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

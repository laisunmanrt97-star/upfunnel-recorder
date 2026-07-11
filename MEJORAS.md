# Análisis del proyecto — lo que hacemos bien y lo que se puede mejorar

> Última actualización: 2026-07-11
> Cubre el ecosistema completo: **SnapRec** (grabador/capturador web) y **SnapEdit** (capturas de escritorio en Electron).

---

## ✅ Lo que estamos haciendo bien

### Decisiones de arquitectura
1. **Diseñar para el hardware real.** Todo el proyecto parte de una restricción honesta: el PC (i5-6300U, 2 núcleos, 6 GB RAM) no aguanta OBS. Cada decisión técnica — pipeline nativo del navegador, guardado en streaming a disco, cámara sin composición cuando no hace falta — existe para respetar ese límite. Es lo contrario de sobre-ingeniería.
2. **Cero dependencias en el frontend.** JS vanilla, sin frameworks, sin build. La app carga instantáneamente, no hay `npm install` que se rompa, y cualquier archivo se entiende leyéndolo de arriba a abajo.
3. **Sitio estático puro.** El VPS no ejecuta nada: no hay backend que mantener, parchear ni escalar. Los videos nunca tocan el servidor (privacidad gratis).
4. **La herramienta correcta para cada trabajo.** Escritorio para el atajo global instantáneo (Ctrl+Shift+S), web para grabar y para usar desde cualquier máquina. No se forzó una sola tecnología a hacer todo mal.
5. **Guardado en streaming a disco** (File System Access API): la RAM se mantiene plana aunque el tutorial dure una hora. Pocos grabadores web hacen esto.

### Proceso
6. **Bitácoras vivas (PROGRESO.md)** en ambos proyectos: cada bug, su causa y su solución quedan documentados. El proyecto es retomable por cualquiera (incluida una IA en una sesión futura) sin arqueología.
7. **Git desde el inicio, commits atómicos y descriptivos.** Cada feature es un commit con contexto del porqué.
8. **Verificación antes de entregar**: el compositor de cámara se probó con streams sintéticos verificando píxeles del video resultante; el rebranding pasó por el validador oficial del brand book.
9. **Identidad visual unificada** (ADN Upfunnel): las dos apps y cualquier pieza futura comparten paleta, tipografía y logo oficial — se ve profesional y de marca.
10. **Feedback de usuario integrado rápido**: el rechazo a la burbuja con marcos de ventana se convirtió el mismo día en la cámara incrustada limpia.

---

## 🔧 Lo que se puede mejorar

### Riesgos reales (atender primero)
1. **Cero pruebas automatizadas.** Todo se verifica a mano o con scripts ad-hoc. Un refactor puede romper el flujo de guardado sin que nadie lo note hasta perder una grabación real. *Mínimo viable: un smoke test con Playwright que grabe 5 segundos con streams falsos y verifique que el archivo resultante reproduce.*
2. **El modo área + anotaciones + cámara apilan costo de CPU** en un equipo que ya va justo. Falta medir de verdad: una grabación de 10 minutos con todo activado mientras corre la app que se demuestra. *Hasta no medir, es una promesa, no un hecho.*
3. **La grabación no sobrevive un crash de la pestaña.** Si Chrome mata la pestaña a mitad de un tutorial de 40 minutos, el .webm queda truncado (usualmente reproducible por cómo escribimos chunks, pero sin garantía). *Mejora: escribir un manifiesto de recuperación o al menos avisar del riesgo en la UI.*
4. **Token de GitHub expuesto en conversación** durante el setup del repo. Ya se recomendó revocarlo — hacerlo. *Regla general: tokens siempre fine-grained, de un solo repo, y rotados tras usarse en un canal no cifrado de extremo a extremo.*
5. **SnapEdit sigue en modo Electron legacy** (`nodeIntegration: true`, sin `contextIsolation`). Riesgo bajo mientras solo abra archivos locales, pero es deuda conocida con solución ya diseñada en su PROGRESO.md (§A6). Atender antes de distribuir la app a terceros.

### Mejoras de producto (orden sugerido)
6. **WebM → MP4.** YouTube acepta WebM, pero WhatsApp/Instagram y algunos editores no lo quieren. Candidato natural: conversión con ffmpeg en el VPS (subes, convierte, descargas) o ffmpeg.wasm local para clips cortos.
7. **Multi-monitor de SnapEdit sin probar en hardware real** — la lógica de emparejamiento está verificada solo en código. Probar el día que haya un segundo monitor conectado.
8. **Íconos de SnapEdit desactualizados**: el tray y el .exe aún llevan el crosshair verde del tema viejo; regenerarlos en cian/Jet Black para cerrar el rebranding.
9. **Anotación en vivo con pantalla completa tiene el problema del espejo** (si grabas la pantalla donde está SnapRec, dibujar implica grabar SnapRec). Hoy se mitiga recomendando compartir ventana o pausar→dibujar→reanudar. *Solución de fondo (v2): overlay nativo transparente en SnapEdit escritorio.*
10. **El historial de capturas solo existe en escritorio.** El modo captura web podría recordar las últimas N capturas en IndexedDB.
11. **Sin atajos de teclado en la web** (B/H/T/A/R… como SnapEdit, más espacio = pausar). Barato de añadir y acelera mucho el flujo.
12. **PWA instalable**: manifest + service worker convertirían SnapRec en "app" con ícono propio y ventana sin pestañas — sensación de app nativa gratis.

### Proceso
13. **Los dos proyectos comparten filosofía pero no código** (la selección de área existe en 2 versiones, los colores de tinta en 2 sitios). Aceptable al tamaño actual; si nace una tercera herramienta, extraer un paquete común.
14. **Definir "hecho" como "probado por Gabriel en su flujo real"**, no como "el código está escrito". Varias features (multi-monitor, grabación larga, deploy) están en estado "código listo, prueba real pendiente" — está bien, pero la bitácora debe seguir marcando esa diferencia con honestidad.
15. **Backups del código**: SnapRec ya vive en GitHub; SnapEdit sigue solo en el disco local. Subirlo a un repo privado — un disco que muere no debería llevarse la app.

---

## Estado de despliegue (foto de hoy)

| Pieza | Estado |
|---|---|
| SnapEdit escritorio | ✅ Funcionando con tema Upfunnel y fix de capturas |
| SnapRec grabación (pantalla/área + cámara incrustada + mic) | ✅ Código listo, probado localmente |
| SnapRec anotación en vivo (flechas, texto, resaltado al grabar) | ✅ Código listo — **pendiente prueba real** |
| SnapRec modo captura con editor completo | ✅ Código listo — **pendiente prueba real** |
| Deploy en Coolify (VPS) | 🔶 En proceso por Gabriel (rama `main` lista) |
| Prueba real de tutorial completo | ⬜ La prueba de fuego pendiente |

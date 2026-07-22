# Plan de accion de SnapRec

Decisiones de producto confirmadas:

- Las anotaciones deben estar disponibles en todos los modos de grabacion.
- Habra dos modos de guardado: memoria para grabaciones normales y escritura directa a disco para grabaciones largas.
- El despliegue oficial sera mediante un subdominio, no bajo `/rec/`.
- Se mantiene la arquitectura HTML, CSS y JavaScript vanilla.

## 1. Integridad del nucleo

- Usar el compositor Canvas en todas las grabaciones.
- Componer las anotaciones mientras esten habilitadas, sin detectar contenido mediante un unico pixel.
- Preservar resolucion, codec, duracion, tamano y titulo antes de limpiar el recorder.
- Hacer la finalizacion idempotente y evitar resultados duplicados.
- Limpiar pantalla, camara, microfono y AudioContext ante cualquier error de inicio.
- Continuar sin camara o microfono cuando alguno no este disponible.
- Cancelar correctamente el flujo si la captura termina durante el countdown.

Criterios: las anotaciones aparecen en el archivo; pantalla completa sin camara permite dibujar; IndexedDB conserva titulo, resolucion y codec; detener varias veces produce un solo resultado; un fallo no deja dispositivos activos.

## 2. PiP y ciclos repetidos

- Restaurar canvas, overlays y toolbar al cerrar Document PiP.
- Crear inputs flotantes en el documento propietario del canvas.
- Limpiar listeners y referencias de ventanas cerradas.
- Probar dos grabaciones consecutivas sin recargar.

Criterios: abrir, cerrar y reabrir PiP no pierde controles; texto y formas funcionan dentro de PiP; la segunda grabacion conserva toda la funcionalidad.

## 3. Grabaciones largas

- Incorporar los modos `Normal` y `Larga` en la interfaz.
- Invocar `showSaveFilePicker()` directamente desde el gesto del usuario.
- Serializar escrituras de chunks y cerrar o abortar el archivo correctamente.
- No presentar como exitoso un archivo parcial.
- Explicar en la interfaz las diferencias de revision y consumo de RAM.

Criterios: el modo largo mantiene estable la RAM; cancelar el selector no inicia la captura; los errores de escritura no generan resultados enganosos; el modo normal conserva la revision antes de descargar.

## 4. Memoria y rendimiento

- Sustituir el limite fijo de snapshots por un presupuesto de memoria dependiente de la resolucion.
- Limitar el bitrate maximo para salidas de alta resolucion.
- Liberar object URLs, canvas auxiliares y streams al terminar.
- Ofrecer una accion visible para detener el stream reutilizado del modo captura.
- Verificar sesiones 1080p y 4K en el hardware objetivo.

## 5. Estadisticas

- Aplicar el periodo seleccionado a KPIs, grafica y tabla.
- Registrar listeners de filtros una sola vez.
- Agrupar fechas en zona horaria local.
- Evitar escaneos completos innecesarios de IndexedDB.
- Renderizar datos persistidos como texto, no como HTML.
- Manejar la ausencia de Chart.js sin romper la vista.

## 6. PWA y seguridad

- Mantener como despliegue oficial `rec.tudominio.com` y retirar la opcion `/rec/`.
- Completar las instrucciones con todos los recursos requeridos.
- Autoalojar Chart.js y la fuente Inter.
- Revisar precache, navegacion y actualizacion del service worker.
- Sincronizar la version de la aplicacion y de la cache.
- Anadir CSP, `nosniff`, `Referrer-Policy`, proteccion contra framing y HSTS.

## 7. Accesibilidad

- Completar semantica ARIA de tabs y selectores.
- Anunciar estados, countdown y resultados mediante regiones vivas.
- Migrar la seleccion de area a Pointer Events.
- Mejorar objetivos tactiles y respetar `prefers-reduced-motion`.
- Proporcionar una alternativa textual para la grafica.

## 8. Pruebas y documentacion

- Cubrir anotaciones en el video, metadatos, ciclos consecutivos, doble stop, permisos denegados, finalizacion durante countdown, filtros y modo largo.
- Separar smoke tests rapidos de pruebas de integracion con navegador real.
- Unificar versiones y corregir `PROGRESO.md` y `MEJORAS.md`.
- Mantener `README.md` y `AGENTS.md` como fuentes operativas actuales.
- Versionar `package-lock.json` e ignorar `desktop.ini`.

## Orden de ejecucion

1. Integridad del nucleo.
2. PiP y ciclos repetidos.
3. Grabaciones largas.
4. Memoria y rendimiento.
5. Estadisticas.
6. PWA y seguridad.
7. Accesibilidad.
8. Pruebas y documentacion final.

Cada fase debe terminar con pruebas de regresion antes de comenzar la siguiente.

## Estado

- Fase 1: implementada el 2026-07-21; suite sintetica y verificacion de frames decodificados completadas. Pendiente validacion manual con permisos y hardware reales.
- Fase 2: implementada el 2026-07-21; el PiP muestra la composicion grabada, permite arrastrar la camara dentro del video, restaura canvas/overlay/toolbar y tiene cobertura de ciclos consecutivos. Pendiente validacion manual de Document PiP real.
- Fases 3 a 8: pendientes.

### Correccion de compatibilidad MP4 (2026-07-21)

- Se elimino `video/webm;codecs=h264,opus`: Chromium producia Matroska con extension WebM y algunos servicios interpretaban mal su duracion.
- Las nuevas grabaciones exigen MP4 con H.264/AAC mediante identificadores `avc1` y `mp4a` estandar.
- El modo normal genera un unico MP4 autocontenido al detener; los fragmentos periodicos quedan reservados para escritura directa a disco.
- Si el navegador no soporta MP4 nativo, la aplicacion pide actualizar Chrome/Edge en lugar de generar un fallback incompatible.
- La cache del service worker se incremento para retirar el recorder anterior.

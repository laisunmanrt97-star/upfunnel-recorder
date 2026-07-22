# Seguridad operativa

## Despliegue

- Desplegar en la raiz de un subdominio dedicado y usar `deploy/nginx.conf.example` como base.
- Ejecutar `nginx -t` antes de recargar nginx.
- Confirmar la redireccion HTTP a HTTPS y las cabeceras CSP, HSTS, X-Frame-Options, nosniff y Permissions-Policy desde el dominio real.
- Mantener Basic Auth solo si se acepta que una sesion ya abierta sigue disponible hasta cerrar la pagina.

## Verificacion manual

- Probar Chrome y Edge con camara, microfono, audio del sistema y pantalla reales.
- Denegar y cancelar cada permiso; ningun indicador de captura debe permanecer al volver al setup.
- Probar Document Picture-in-Picture en Chrome o Edge 116 o posterior.
- Decodificar frames y audio de un MP4 descargado; la firma del contenedor no es suficiente.
- Probar grabaciones largas con guardado directo y simular disco lleno o escritura denegada.

## Respuesta a incidentes

- Revocar inmediatamente cualquier token compartido en conversaciones, registros o capturas.
- Revisar los eventos de auditoria del proveedor y rotar credenciales relacionadas.
- No guardar tokens, `.env`, claves, grabaciones ni capturas sensibles en Git.

## Comandos locales

```text
npm ci
npm audit
npm test
npm run test:security
```

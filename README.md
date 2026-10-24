# XiNews

Maqueta navegable (PWA) del widget de noticias de Xinhua para celulares Android, con backend reutilizable para el futuro widget nativo.

| Carpeta | Servicio Easypanel | Dominio |
|---|---|---|
| `api/` | `xinhua/xinews-api` (Node 20) | https://api.xinews.informadorweb.com.mx |
| `pwa/` | `xinhua/xinews-pwa` (nginx) | https://xinews.informadorweb.com.mx |
| — | `xinhua/xinews-db` (PostgreSQL 16) | interno |
| — | `xinhua/xinews-minio` (MinIO, S3) | interno |

## Flujo de datos
1. **Ingesta** (cada 10 min): lee `informadorweb.com.mx/wp-json/wp/v2/posts` y sus adjuntos (`/media?parent=`). Solo guarda notas **con foto** en la tabla `noticias_widget`.
2. **Foto grande**: n8n la extrae del detalle de la nota en Xinhua y la sube a `POST /v1/news/foto-grande` (cabecera `x-api-key`). Se guarda en MinIO y se usa solo en el widget.
3. **Limpieza**: cada 30 min se borran de MinIO las fotos grandes con más de 48 h (`PHOTO_TTL_HOURS`).
4. **Anuncios**: `api/seed/ads.json` (marcas chinas, marcados "Ejemplo de pauta"). Las imágenes se copian a MinIO al arrancar.

## Endpoints
`GET /v1` lista todos. Principales: `/v1/widget`, `/v1/feed`, `/v1/news/:id`, `/v1/ads`, `/v1/stats`, `POST /v1/events`.

### Carga de foto grande desde n8n
```
POST https://api.xinews.informadorweb.com.mx/v1/news/foto-grande
x-api-key: <API_KEY>
Content-Type: application/json

{ "wp_id": 1716289, "image_url": "https://.../foto-grande.jpg" }
```
También acepta `url` (enlace de la nota en WordPress) o `titulo` en lugar de `wp_id`, y `multipart/form-data` con `file`.

## Variables de entorno (api)
`DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `API_KEY`, `PUBLIC_BASE`, `WP_BASE`, `WP_SITE`, `INGEST_EVERY_MIN`, `PHOTO_TTL_HOURS`, `CLEANUP_EVERY_MIN`, `AD_EVERY`.

## Widget nativo (siguiente fase)
Kotlin + Jetpack Glance consumiendo `/v1/widget` (titulares + 1 anuncio) y `/v1/events` para impresiones y clics.

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  port: Number(env('PORT', 3000)),
  databaseUrl: env('DATABASE_URL', 'postgres://xinews:xinews@xinhua_xinews-db:5432/xinews'),
  // Sitio WordPress que replica a Xinhua
  wpBase: env('WP_BASE', 'https://informadorweb.com.mx'),
  wpSite: env('WP_SITE', 'informadorweb.com.mx'),
  ingestEveryMin: Number(env('INGEST_EVERY_MIN', 10)),
  // Fotos grandes: se borran a las N horas
  photoTtlHours: Number(env('PHOTO_TTL_HOURS', 48)),
  cleanupEveryMin: Number(env('CLEANUP_EVERY_MIN', 30)),
  // Almacenamiento S3 (MinIO)
  s3: {
    endpoint: env('S3_ENDPOINT', 'http://xinhua_minio:9000'),
    region: env('S3_REGION', 'us-east-1'),
    accessKeyId: env('S3_ACCESS_KEY', ''),
    secretAccessKey: env('S3_SECRET_KEY', ''),
    bucket: env('S3_BUCKET', 'xinews'),
  },
  // Clave para n8n (carga de fotos grandes) y tareas administrativas
  apiKey: env('API_KEY', ''),
  publicBase: env('PUBLIC_BASE', 'https://api.xinews.informadorweb.com.mx'),
  corsOrigins: env('CORS_ORIGINS', '*'),
  // Cada cuántas notas se inserta un anuncio en el feed
  adEvery: Number(env('AD_EVERY', 5)),
};

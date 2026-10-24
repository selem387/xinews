// Tareas programadas: ingesta periódica, limpieza de fotos grandes (48 h) y caché de anuncios en MinIO
const cfg = require('./config');
const { q } = require('./db');
const storage = require('./storage');
const { runIngest } = require('./ingest');

const state = { lastIngest: null, lastCleanup: null, lastAds: null };

async function cleanupPhotos() {
  const { rows } = await q(
    `SELECT id, foto_grande_key FROM noticias_widget
     WHERE foto_grande_key IS NOT NULL AND foto_grande_at < now() - ($1 || ' hours')::interval`,
    [String(cfg.photoTtlHours)]
  );
  let borradas = 0;
  for (const r of rows) {
    try { await storage.del(r.foto_grande_key); } catch (e) { console.warn('del', r.foto_grande_key, e.message); }
    await q('UPDATE noticias_widget SET foto_grande_key=NULL, foto_grande_at=NULL WHERE id=$1', [r.id]);
    borradas++;
  }
  state.lastCleanup = { at: new Date().toISOString(), borradas };
  return state.lastCleanup;
}

async function cacheAds() {
  const { rows } = await q(
    `SELECT id, imagen_origen_url FROM anuncios WHERE imagen_key IS NULL AND imagen_origen_url IS NOT NULL AND activo`
  );
  let ok = 0; const errores = [];
  for (const a of rows) {
    try {
      const key = `anuncios/${a.id}-${Date.now()}`;
      await storage.putFromUrl(key, a.imagen_origen_url);
      await q('UPDATE anuncios SET imagen_key=$1 WHERE id=$2', [key, a.id]);
      ok++;
    } catch (e) { errores.push({ id: a.id, error: e.message }); }
  }
  state.lastAds = { at: new Date().toISOString(), ok, errores };
  return state.lastAds;
}

async function ingestSafe() {
  try { state.lastIngest = { at: new Date().toISOString(), ...(await runIngest()) }; }
  catch (e) { state.lastIngest = { at: new Date().toISOString(), error: e.message }; console.error('ingest', e); }
  return state.lastIngest;
}

function start() {
  ingestSafe();
  setInterval(ingestSafe, cfg.ingestEveryMin * 60e3);
  setInterval(() => cleanupPhotos().catch((e) => console.error('cleanup', e)), cfg.cleanupEveryMin * 60e3);
  cacheAds().catch((e) => console.error('ads', e));
  setInterval(() => cacheAds().catch((e) => console.error('ads', e)), 60 * 60e3);
}

module.exports = { start, cleanupPhotos, cacheAds, ingestSafe, state };

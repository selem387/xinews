const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cfg = require('./config');
const { q, migrate } = require('./db');
const storage = require('./storage');
const jobs = require('./jobs');

const app = express();
app.set('trust proxy', true);
app.use(cors({ origin: cfg.corsOrigins === '*' ? true : cfg.corsOrigins.split(',') }));
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const requireKey = (req, res, next) => {
  if (!cfg.apiKey) return res.status(503).json({ error: 'API_KEY no configurada' });
  if (req.get('x-api-key') !== cfg.apiKey) return res.status(401).json({ error: 'no autorizado' });
  next();
};

// ---------- Serialización ----------
const titleCase = (s = '') => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
const imgNews = (n) => (n.foto_grande_key ? `${cfg.publicBase}/v1/img/news/${n.id}` : n.foto_wp_url);
function newsOut(n, full = false) {
  const o = {
    id: n.id,
    tipo: 'noticia',
    titulo: n.titulo,
    resumen: n.resumen,
    categoria: titleCase(n.categoria),
    publicado_at: n.publicado_at,
    url: n.url,
    imagen: imgNews(n),
    imagen_hd: Boolean(n.foto_grande_key),
    miniatura: n.foto_wp_url,
    pie: n.foto_pie || null,
    credito: n.foto_credito ? `Xinhua/${n.foto_credito}` : 'Xinhua',
    fuente: 'Xinhua',
    ubicacion: n.ubicacion || null,
    fotos: n.fotos || 1,
    lectura_min: Math.max(1, Math.round(String(n.cuerpo_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).length / 200)),
  };
  if (full) o.cuerpo_html = n.cuerpo_html;
  return o;
}
const adOut = (a) => ({
  id: a.id,
  tipo: 'anuncio',
  marca: a.marca,
  sector: a.sector,
  titular: a.titular,
  producto: a.producto,
  formato: a.formato,
  etiqueta: a.etiqueta,
  imagen: a.imagen_key ? `${cfg.publicBase}/v1/img/ad/${a.id}` : a.imagen_origen_url,
  cta_url: `${cfg.publicBase}/v1/click/${a.id}`,
});

async function latestNews(limit, offset = 0, categoria) {
  const params = [limit, offset];
  let where = '';
  if (categoria) { params.push(categoria); where = `WHERE lower(categoria)=lower($3)`; }
  // Xinhua publica galerías como varias notas del mismo grupo: se deja una por grupo (la de foto HD o la más ancha)
  const { rows } = await q(
    `SELECT t.*, g.fotos FROM (
       SELECT DISTINCT ON (COALESCE(grupo, titulo)) * FROM noticias_widget ${where}
       ORDER BY COALESCE(grupo, titulo), (foto_grande_key IS NOT NULL) DESC, foto_wp_ancho DESC NULLS LAST, wp_id ASC
     ) t
     JOIN LATERAL (SELECT count(*)::int fotos FROM noticias_widget x WHERE x.grupo = t.grupo) g ON true
     ORDER BY publicado_at DESC NULLS LAST, id DESC LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}
async function activeAds() {
  const { rows } = await q('SELECT * FROM anuncios WHERE activo ORDER BY random() * (1 + prioridad) DESC');
  return rows;
}

// ---------- Salud y configuración ----------
app.get('/', (_req, res) => res.json({ servicio: 'xinews-api', version: '0.1.0', docs: '/v1' }));
app.get('/health', async (_req, res) => {
  try { await q('SELECT 1'); res.json({ ok: true, storage: storage.isReady(), jobs: jobs.state }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/v1', (_req, res) => res.json({
  endpoints: {
    'GET /v1/config': 'Configuración del widget',
    'GET /v1/widget': 'Contenido para el widget de pantalla de inicio (titulares + 1 anuncio)',
    'GET /v1/feed?limit=&offset=&categoria=': 'Feed del portal con anuncios intercalados',
    'GET /v1/news/:id': 'Detalle de nota',
    'GET /v1/categorias': 'Categorías con conteo',
    'GET /v1/ads': 'Anuncios activos',
    'POST /v1/events': 'Registrar impresión o clic {tipo, anuncio_id?, noticia_id?, superficie?, sesion?}',
    'GET /v1/stats': 'Métricas de la demo',
    'POST /v1/news/foto-grande (x-api-key)': 'n8n sube la foto grande: JSON {wp_id|url, image_url} o multipart (file + wp_id|url)',
    'POST /v1/admin/ingest (x-api-key)': 'Forzar ingesta',
    'POST /v1/admin/cleanup (x-api-key)': 'Forzar limpieza de fotos > TTL',
  },
}));
app.get('/v1/config', (_req, res) => res.json({
  marca: 'XiNews',
  subtitulo: '新华新闻 · Noticias de Xinhua',
  fuente: 'Agencia de Noticias Xinhua',
  anuncio_cada: cfg.adEvery,
  refresco_min: cfg.ingestEveryMin,
  ttl_fotos_horas: cfg.photoTtlHours,
  colores: { primario: '#C3141E', secundario: '#0F2340' },
}));

// ---------- Widget y feed ----------
app.get('/v1/widget', async (_req, res, next) => {
  try {
    const [news, ads] = await Promise.all([latestNews(6), activeAds()]);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      actualizado_at: new Date().toISOString(),
      destacada: news[0] ? newsOut(news[0]) : null,
      titulares: news.slice(1).map((n) => newsOut(n)),
      anuncio: ads[0] ? adOut(ads[0]) : null,
    });
  } catch (e) { next(e); }
});

app.get('/v1/feed', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = Number(req.query.offset) || 0;
    const [news, ads] = await Promise.all([latestNews(limit, offset, req.query.categoria), activeAds()]);
    const items = []; let ai = Math.floor(offset / cfg.adEvery);
    news.forEach((n, i) => {
      items.push(newsOut(n));
      if (ads.length && (i + 1) % cfg.adEvery === 0) items.push(adOut(ads[ai++ % ads.length]));
    });
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items, siguiente: news.length === limit ? offset + limit : null });
  } catch (e) { next(e); }
});

app.get('/v1/news/:id', async (req, res, next) => {
  try {
    const { rows } = await q('SELECT * FROM noticias_widget WHERE id=$1', [Number(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'no encontrada' });
    const n = rows[0];
    const [ads, gal] = await Promise.all([
      activeAds(),
      n.grupo ? q(`SELECT * FROM noticias_widget WHERE grupo=$1 ORDER BY wp_id ASC LIMIT 12`, [n.grupo]) : { rows: [] },
    ]);
    const galeria = gal.rows.map((g) => ({ id: g.id, imagen: imgNews(g), imagen_hd: Boolean(g.foto_grande_key), pie: g.foto_pie, credito: g.foto_credito ? `Xinhua/${g.foto_credito}` : 'Xinhua' }));
    res.json({ ...newsOut({ ...n, fotos: galeria.length || 1 }, true), galeria, anuncio: ads[0] ? adOut(ads[0]) : null });
  } catch (e) { next(e); }
});

app.get('/v1/categorias', async (_req, res, next) => {
  try {
    const { rows } = await q(`SELECT categoria, count(*)::int AS notas FROM noticias_widget GROUP BY 1 ORDER BY 2 DESC`);
    res.json(rows.map((r) => ({ ...r, nombre: titleCase(r.categoria) })));
  } catch (e) { next(e); }
});

app.get('/v1/ads', async (_req, res, next) => {
  try { res.json((await activeAds()).map(adOut)); } catch (e) { next(e); }
});

// ---------- Imágenes desde MinIO ----------
async function streamKey(key, res) {
  const obj = await storage.get(key);
  res.set('Content-Type', obj.ContentType || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  obj.Body.pipe(res);
}
app.get('/v1/img/news/:id', async (req, res) => {
  const { rows } = await q('SELECT foto_grande_key, foto_wp_url FROM noticias_widget WHERE id=$1', [Number(req.params.id)]);
  const n = rows[0];
  if (!n) return res.sendStatus(404);
  if (!n.foto_grande_key) return n.foto_wp_url ? res.redirect(302, n.foto_wp_url) : res.sendStatus(404);
  try { await streamKey(n.foto_grande_key, res); } catch { n.foto_wp_url ? res.redirect(302, n.foto_wp_url) : res.sendStatus(404); }
});
app.get('/v1/img/ad/:id', async (req, res) => {
  const { rows } = await q('SELECT imagen_key, imagen_origen_url FROM anuncios WHERE id=$1', [Number(req.params.id)]);
  const a = rows[0];
  if (!a) return res.sendStatus(404);
  if (!a.imagen_key) return a.imagen_origen_url ? res.redirect(302, a.imagen_origen_url) : res.sendStatus(404);
  try { await streamKey(a.imagen_key, res); } catch { a.imagen_origen_url ? res.redirect(302, a.imagen_origen_url) : res.sendStatus(404); }
});

// ---------- Eventos y métricas ----------
app.post('/v1/events', async (req, res) => {
  const { tipo, anuncio_id, noticia_id, superficie, sesion } = req.body || {};
  if (!['impresion', 'clic', 'apertura', 'vista_nota'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
  await q('INSERT INTO eventos (tipo, anuncio_id, noticia_id, superficie, sesion, ua) VALUES ($1,$2,$3,$4,$5,$6)',
    [tipo, anuncio_id || null, noticia_id || null, superficie || null, sesion || null, (req.get('user-agent') || '').slice(0, 300)]);
  res.status(204).end();
});
app.get('/v1/click/:id', async (req, res) => {
  const { rows } = await q('SELECT cta_url FROM anuncios WHERE id=$1', [Number(req.params.id)]);
  if (!rows[0]) return res.sendStatus(404);
  q('INSERT INTO eventos (tipo, anuncio_id, superficie, ua) VALUES ($1,$2,$3,$4)',
    ['clic', Number(req.params.id), req.query.s || null, (req.get('user-agent') || '').slice(0, 300)]).catch(() => {});
  res.redirect(302, rows[0].cta_url || '/');
});
app.get('/v1/stats', async (_req, res, next) => {
  try {
    const [n, ev, ads] = await Promise.all([
      q(`SELECT count(*)::int total, count(foto_grande_key)::int con_foto_hd, max(publicado_at) ultima FROM noticias_widget`),
      q(`SELECT tipo, count(*)::int FROM eventos WHERE creado_at > now() - interval '7 days' GROUP BY 1`),
      q(`SELECT a.marca, count(e.*) FILTER (WHERE e.tipo='impresion')::int impresiones, count(e.*) FILTER (WHERE e.tipo='clic')::int clics
         FROM anuncios a LEFT JOIN eventos e ON e.anuncio_id=a.id AND e.creado_at > now() - interval '7 days'
         GROUP BY a.marca ORDER BY 2 DESC`),
    ]);
    res.json({ noticias: n.rows[0], eventos_7d: ev.rows, anuncios_7d: ads.rows, jobs: jobs.state });
  } catch (e) { next(e); }
});

// ---------- n8n: carga de foto grande ----------
app.post('/v1/news/foto-grande', requireKey, upload.single('file'), async (req, res, next) => {
  try {
    const b = req.body || {};
    let row;
    if (b.wp_id) row = (await q('SELECT id FROM noticias_widget WHERE wp_id=$1 ORDER BY id DESC LIMIT 1', [Number(b.wp_id)])).rows[0];
    else if (b.url) row = (await q('SELECT id FROM noticias_widget WHERE url=$1 LIMIT 1', [b.url])).rows[0];
    else if (b.titulo) row = (await q('SELECT id FROM noticias_widget WHERE titulo=$1 ORDER BY id DESC LIMIT 1', [b.titulo])).rows[0];
    if (!row) return res.status(404).json({ error: 'nota no encontrada (aún no ingerida); reintentar tras la próxima ingesta', wp_id: b.wp_id, url: b.url });

    const key = `noticias/${row.id}-${Date.now()}`;
    if (req.file) await storage.putImage(key, req.file.buffer, req.file.mimetype, 1600);
    else if (b.image_url) await storage.putFromUrl(key, b.image_url);
    else return res.status(400).json({ error: 'falta file o image_url' });

    const prev = (await q('SELECT foto_grande_key FROM noticias_widget WHERE id=$1', [row.id])).rows[0];
    await q('UPDATE noticias_widget SET foto_grande_key=$1, foto_grande_at=now() WHERE id=$2', [key, row.id]);
    if (prev?.foto_grande_key) storage.del(prev.foto_grande_key).catch(() => {});
    res.json({ ok: true, noticia_id: row.id, imagen: `${cfg.publicBase}/v1/img/news/${row.id}`, expira_en_horas: cfg.photoTtlHours });
  } catch (e) { next(e); }
});

// ---------- Admin ----------
app.post('/v1/admin/ingest', requireKey, async (_req, res) => res.json(await jobs.ingestSafe()));
app.post('/v1/admin/cleanup', requireKey, async (_req, res, next) => { try { res.json(await jobs.cleanupPhotos()); } catch (e) { next(e); } });
app.post('/v1/admin/ads/recache', requireKey, async (_req, res, next) => {
  try { await q('UPDATE anuncios SET imagen_key=NULL'); res.json(await jobs.cacheAds()); } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: err.message }); });

// ---------- Arranque ----------
async function seedAds() {
  const file = path.join(__dirname, '..', 'seed', 'ads.json');
  if (!fs.existsSync(file)) return;
  const ads = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const a of ads) {
    await q(
      `INSERT INTO anuncios (marca, sector, titular, producto, cta_url, imagen_origen_url, formato, prioridad, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (marca, producto) DO UPDATE SET sector=EXCLUDED.sector, titular=EXCLUDED.titular,
         cta_url=EXCLUDED.cta_url, formato=EXCLUDED.formato, prioridad=EXCLUDED.prioridad, activo=EXCLUDED.activo,
         imagen_key = CASE WHEN anuncios.imagen_origen_url IS DISTINCT FROM EXCLUDED.imagen_origen_url THEN NULL ELSE anuncios.imagen_key END,
         imagen_origen_url=EXCLUDED.imagen_origen_url`,
      [a.brand, a.sector, a.headline, a.product, a.cta_url, a.image_url, a.formato || 'nativo', a.prioridad || 0, a.activo !== false]
    );
  }
}

(async () => {
  await migrate();
  await seedAds();
  try { await storage.ensureBucket(); } catch (e) { console.error('MinIO no disponible:', e.message); }
  jobs.start();
  app.listen(cfg.port, () => console.log(`xinews-api escuchando en :${cfg.port}`));
})().catch((e) => { console.error(e); process.exit(1); });

// Ingesta: lee el WordPress que replica a Xinhua y guarda SOLO las notas con foto.
// Las fotos de WP son miniaturas (~300 px); la foto grande la sube n8n vía /v1/news/foto-grande.
const cfg = require('./config');
const { q } = require('./db');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };
function decode(s = '') {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] ?? m));
}
const stripTags = (s = '') => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Quita el encabezado técnico de los pies de foto de Xinhua: "(261021) -- CIUDAD, fecha (Xinhua) -- "
function cleanCaption(c = '') {
  return c
    .replace(/^\(\d+\)\s*--\s*/, '')
    .replace(/^[^()]*\(Xinhua\)\s*--\s*/, '')
    .replace(/\s*\(Xinhua\/[^)]*\)(\s*\([a-z]{1,3}\))*\s*$/i, '')
    .trim();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'XiNews-ingest/0.1', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

let catCache = { at: 0, map: {} };
async function categories() {
  if (Date.now() - catCache.at < 6 * 3600e3 && Object.keys(catCache.map).length) return catCache.map;
  const list = await getJson(`${cfg.wpBase}/wp-json/wp/v2/categories?per_page=100&_fields=id,name`);
  catCache = { at: Date.now(), map: Object.fromEntries(list.map((c) => [c.id, decode(c.name)])) };
  return catCache.map;
}

async function runIngest() {
  const started = Date.now();
  const posts = await getJson(
    `${cfg.wpBase}/wp-json/wp/v2/posts?per_page=60&_fields=id,date_gmt,link,title,excerpt,content,categories,featured_media`
  );
  if (!posts.length) return { posts: 0, conFoto: 0, nuevas: 0 };

  const ids = posts.map((p) => p.id).join(',');
  const media = await getJson(
    `${cfg.wpBase}/wp-json/wp/v2/media?per_page=100&parent=${ids}&_fields=id,post,source_url,media_details,media_type`
  );
  // También las destacadas, si algún día se usan
  const featuredIds = posts.map((p) => p.featured_media).filter(Boolean);
  if (featuredIds.length) {
    try {
      const fm = await getJson(`${cfg.wpBase}/wp-json/wp/v2/media?per_page=100&include=${featuredIds.join(',')}&_fields=id,post,source_url,media_details,media_type`);
      media.push(...fm);
    } catch { /* opcional */ }
  }

  const byPost = {};
  for (const m of media) {
    if (m.media_type && m.media_type !== 'image') continue;
    const w = m.media_details?.width || 0;
    const prev = byPost[m.post];
    if (!prev || w > (prev.media_details?.width || 0)) byPost[m.post] = m;
  }

  const cats = await categories().catch(() => ({}));
  let conFoto = 0; let nuevas = 0;

  for (const p of posts) {
    let m = byPost[p.id] || media.find((x) => x.id === p.featured_media);
    let fotoUrl = m?.source_url;
    let ancho = m?.media_details?.width || null;
    let alto = m?.media_details?.height || null;
    // Respaldo: una <img> dentro del contenido
    if (!fotoUrl) {
      const img = /<img[^>]+src=["']([^"']+)["']/i.exec(p.content?.rendered || '');
      if (img) fotoUrl = img[1];
    }
    if (!fotoUrl) continue; // Regla: solo notas con foto
    conFoto++;

    const meta = m?.media_details?.image_meta || {};
    const titulo = stripTags(p.title?.rendered);
    const resumen = stripTags(p.excerpt?.rendered).replace(/\s*\[…\]\s*$/, '…');
    const r = await q(
      `INSERT INTO noticias_widget
        (sitio, wp_id, titulo, resumen, cuerpo_html, categoria, url, publicado_at,
         foto_wp_url, foto_wp_ancho, foto_wp_alto, foto_pie, foto_credito)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (sitio, wp_id) DO UPDATE SET
         titulo=EXCLUDED.titulo, resumen=EXCLUDED.resumen, cuerpo_html=EXCLUDED.cuerpo_html,
         categoria=EXCLUDED.categoria, url=EXCLUDED.url,
         foto_wp_url=EXCLUDED.foto_wp_url, foto_wp_ancho=EXCLUDED.foto_wp_ancho, foto_wp_alto=EXCLUDED.foto_wp_alto,
         foto_pie=EXCLUDED.foto_pie, foto_credito=EXCLUDED.foto_credito
       RETURNING (xmax = 0) AS insertada`,
      [
        cfg.wpSite, p.id, titulo, resumen, p.content?.rendered || '',
        cats[p.categories?.[0]] || 'Internacional', p.link,
        p.date_gmt ? new Date(p.date_gmt + 'Z') : new Date(),
        fotoUrl, ancho, alto, cleanCaption(meta.caption || ''), meta.credit || null,
      ]
    );
    if (r.rows[0]?.insertada) nuevas++;
  }
  return { posts: posts.length, conFoto, nuevas, ms: Date.now() - started };
}

module.exports = { runIngest, cleanCaption, decode };

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

// Las fotonoticias de Xinhua traen títulos técnicos ("PERU-LIMA-PESCA (6/6)").
// grupo: la clave de la galería; ubicacion: "Perú · Lima"; titular legible a partir del pie de foto.
const SLUG_RE = /^[A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9 .,'’&\-]+(\s*\(\d+\/?\d*\)?)?$/;
const esSlug = (t = '') => SLUG_RE.test(t.trim()) && t === t.toUpperCase();
const baseSlug = (t = '') => t.replace(/\s*\(\d+\/?\d*\)?\s*$/, '').trim();
const PAISES = { PERU: 'Perú', MEXICO: 'México', ESPANA: 'España', BRASIL: 'Brasil', CHILE: 'Chile', COLOMBIA: 'Colombia', CHINA: 'China', SIRIA: 'Siria', TURQUIA: 'Turquía', IRAN: 'Irán', JAPON: 'Japón', CANADA: 'Canadá', PANAMA: 'Panamá', 'REINO UNIDO': 'Reino Unido', 'EEUU': 'EE. UU.', ONU: 'ONU' };
const tc = (w) => w.toLowerCase().replace(/(^|[\s(])([a-záéíóúüñ])/g, (m, a, b) => a + b.toUpperCase());
function ubicacionDe(slug) {
  const p = baseSlug(slug).split('-').map((s) => s.trim()).filter(Boolean);
  if (!p.length) return null;
  return PAISES[p[0]] || tc(p[0]);
}
function recorta(s, max = 115) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '…';
}
function titularDesdePie(pie = '') {
  if (!pie) return null;
  const limpia = (s) => s
    .replace(/^(Imagen|Foto)(\s+compuesta)?(\s+tomada con un dron)?\s+del?\s+\d{1,2}\s+de\s+\w+\s+de\s+\d{4}\s+(de|del)\s+/i, '')
    .replace(/^Vista aérea tomada con un dron el\s+\d{1,2}\s+de\s+\w+\s+de\s+\d{4}\s+(de|del)\s+/i, 'Vista aérea de ')
    .replace(/,?\s+el\s+\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/gi, '')
    .replace(/\s*\((i|d|c|izq\.|der\.)\)/gi, '')
    .trim();
  const frases = pie.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ"“])/).map(limpia).filter((f) => f.length > 25);
  if (!frases.length) return null;
  // La 2.ª frase suele ser el contexto noticioso; la 1.ª describe la foto
  let t = (frases[1] && frases[1].length < 220 ? frases[1] : frases[0]).replace(/\.$/, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return recorta(t);
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
    const original = stripTags(p.title?.rendered);
    const pie = cleanCaption(meta.caption || '') || cleanCaption(stripTags(p.content?.rendered));
    const slug = esSlug(original);
    const titulo = slug ? (titularDesdePie(pie) || tc(baseSlug(original))) : original;
    const grupo = slug ? baseSlug(original) : original;
    const resumen = slug ? recorta(pie, 220) : stripTags(p.excerpt?.rendered).replace(/\s*\[…\]\s*$/, '…');
    const cuerpo = slug ? (pie ? `<p>${pie.replace(/</g, '&lt;')}</p>` : '') : (p.content?.rendered || '');
    const r = await q(
      `INSERT INTO noticias_widget
        (sitio, wp_id, titulo, resumen, cuerpo_html, categoria, url, publicado_at,
         foto_wp_url, foto_wp_ancho, foto_wp_alto, foto_pie, foto_credito, grupo, titulo_original, ubicacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (sitio, wp_id) DO UPDATE SET
         titulo=EXCLUDED.titulo, resumen=EXCLUDED.resumen, cuerpo_html=EXCLUDED.cuerpo_html,
         categoria=EXCLUDED.categoria, url=EXCLUDED.url,
         foto_wp_url=EXCLUDED.foto_wp_url, foto_wp_ancho=EXCLUDED.foto_wp_ancho, foto_wp_alto=EXCLUDED.foto_wp_alto,
         foto_pie=EXCLUDED.foto_pie, foto_credito=EXCLUDED.foto_credito,
         grupo=EXCLUDED.grupo, titulo_original=EXCLUDED.titulo_original, ubicacion=EXCLUDED.ubicacion
       RETURNING (xmax = 0) AS insertada`,
      [
        cfg.wpSite, p.id, titulo, resumen, cuerpo,
        cats[p.categories?.[0]] || 'Internacional', p.link,
        p.date_gmt ? new Date(p.date_gmt + 'Z') : new Date(),
        fotoUrl, ancho, alto, pie, meta.credit || null, grupo, original, slug ? ubicacionDe(original) : null,
      ]
    );
    if (r.rows[0]?.insertada) nuevas++;
  }
  return { posts: posts.length, conFoto, nuevas, ms: Date.now() - started };
}

module.exports = { runIngest, cleanCaption, decode, titularDesdePie, ubicacionDe, esSlug, baseSlug };

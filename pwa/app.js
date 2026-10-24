/* XiNews PWA: simula el widget de pantalla de inicio y el portal de noticias de Xinhua */
(() => {
  const API = (window.XINEWS_API || 'https://api.xinews.informadorweb.com.mx').replace(/\/$/, '');
  const $app = document.getElementById('app');
  const sesion = (() => { try { let s = localStorage.getItem('xn_s'); if (!s) { s = Math.random().toString(36).slice(2); localStorage.setItem('xn_s', s); } return s; } catch { return 'anon'; } })();
  let widgetSize = (() => { try { return localStorage.getItem('xn_w') || '44'; } catch { return '44'; } })();
  let stickyClosed = false;
  let timers = [];

  // ---------- Utilidades ----------
  const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hace(iso) {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

  async function api(path) {
    const key = 'xn_c' + path;
    try {
      const r = await fetch(API + path, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      try { localStorage.setItem(key, JSON.stringify(j)); } catch {}
      setOffline(false);
      return j;
    } catch (e) {
      try { const c = localStorage.getItem(key); if (c) { setOffline(true); return JSON.parse(c); } } catch {}
      throw e;
    }
  }
  function setOffline(on) {
    let b = document.querySelector('.offline-badge');
    if (on && !b) { b = document.createElement('div'); b.className = 'offline-badge'; b.textContent = 'Sin conexión · mostrando lo guardado'; document.body.appendChild(b); }
    if (!on && b) b.remove();
  }

  // Métricas: impresiones con IntersectionObserver, clics por redirección de la API
  const seen = new Set();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    ents.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target; const k = el.dataset.ad + ':' + el.dataset.sup;
      if (seen.has(k)) return; seen.add(k);
      track({ tipo: 'impresion', anuncio_id: Number(el.dataset.ad), superficie: el.dataset.sup });
      io.unobserve(el);
    });
  }, { threshold: 0.5 }) : null;
  function track(ev) {
    const body = JSON.stringify({ ...ev, sesion });
    try { if (navigator.sendBeacon) { navigator.sendBeacon(API + '/v1/events', new Blob([body], { type: 'application/json' })); return; } } catch {}
    fetch(API + '/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
  const observeAds = () => io && document.querySelectorAll('[data-ad]').forEach((el) => io.observe(el));

  // Clima CDMX (Open-Meteo, sin clave)
  let clima = null;
  const WMO = (c) => (c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 ? '🌧️' : c <= 77 ? '🌨️' : c <= 82 ? '🌦️' : '⛈️');
  async function loadClima() {
    if (clima) return clima;
    try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=19.43&longitude=-99.13&current=temperature_2m,weather_code&timezone=America%2FMexico_City');
      const j = await r.json();
      clima = { t: Math.round(j.current.temperature_2m), i: WMO(j.current.weather_code) };
    } catch { clima = null; }
    return clima;
  }

  // ---------- Piezas ----------
  const img = (src, alt = '', cls = '') => `<img src="${esc(src || 'icons/placeholder.svg')}" alt="${esc(alt)}" loading="lazy" decoding="async" ${cls ? `class="${cls}"` : ''} onerror="this.onerror=null;this.src='icons/placeholder.svg'">`;
  const metaNota = (n) => `<span class="meta">Xinhua · ${hace(n.publicado_at)} · ${n.fotos > 1 ? `${n.fotos} fotos` : `${n.lectura_min} min`}${n.imagen_hd ? '<span class="hd">HD</span>' : ''}</span>`;
  const kick = (n) => esc(n.ubicacion || n.categoria);
  const etiquetaAd = (a) => `<span class="etq">Patrocinado · ${esc(a.etiqueta || 'Ejemplo de pauta')}</span>`;

  function adCard(a, sup) {
    if (!a) return '';
    return `<a class="ad" href="${esc(a.cta_url)}?s=${sup}" target="_blank" rel="noopener sponsored" data-ad="${a.id}" data-sup="${sup}">
      <div class="adtop"><b>${esc(a.marca)}</b>${etiquetaAd(a)}</div>
      ${img(a.imagen, a.marca + ' ' + (a.producto || ''))}
      <div class="adpie"><strong>${esc(a.titular || a.producto || a.marca)}</strong><span class="cta">Ver más</span></div>
    </a>`;
  }

  // ---------- Pantalla de inicio con widget ----------
  async function renderInicio() {
    const now = new Date();
    const hora = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    const fecha = now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    $app.innerHTML = `
      <div class="home">
        <div class="statusbar"><span>${hora}</span><span class="ic">
          <svg viewBox="0 0 24 24"><path d="M2 22h20V2z"/></svg>
          <svg viewBox="0 0 24 24"><path d="M12 21 1 8a16 16 0 0 1 22 0z"/></svg>
          <svg viewBox="0 0 24 24"><path d="M16 4h-1V2H9v2H8a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/></svg></span></div>
        <div class="clock"><div class="hora">${hora}</div><div class="fecha"><span>${fecha}</span><span class="clima" id="clima"></span></div></div>
        <div id="w">${widgetSkeleton()}</div>
        <div class="demo-sw" role="group" aria-label="Tamaño del widget">
          <button data-w="42" class="${widgetSize === '42' ? 'on' : ''}">Widget 4×2</button>
          <button data-w="44" class="${widgetSize === '44' ? 'on' : ''}">Widget 4×4</button>
        </div>
        <div class="hint">Toca una noticia para abrir el portal XiNews</div>
        <div class="apps">
          ${['📞|Teléfono', '💬|Mensajes', '📷|Cámara', '🗺️|Mapas', '🎵|Música', '⚙️|Ajustes', '🛒|Tienda', '📧|Correo'].map((a) => { const [i, t] = a.split('|'); return `<div class="app"><i>${i}</i><span>${t}</span></div>`; }).join('')}
        </div>
        <div class="dock">${['📞', '💬', '🌐', '📷'].map((i) => `<div class="app"><i>${i}</i></div>`).join('')}</div>
      </div>`;
    $app.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
      widgetSize = b.dataset.w; try { localStorage.setItem('xn_w', widgetSize); } catch {}
      renderInicio();
    }));
    loadClima().then((c) => { const el = document.getElementById('clima'); if (el && c) el.textContent = `${c.i} ${c.t}° CDMX`; });
    try {
      const d = await api('/v1/widget');
      document.getElementById('w').innerHTML = widgetSize === '42' ? widget42(d) : widget44(d);
      if (widgetSize === '42') startCarrusel();
      observeAds();
      track({ tipo: 'apertura', superficie: 'widget' + widgetSize });
    } catch (e) {
      document.getElementById('w').innerHTML = `<div class="widget"><div class="aviso">No se pudo cargar el widget: ${esc(e.message)}</div></div>`;
    }
  }
  const widgetSkeleton = () => `<div class="widget ${widgetSize === '42' ? 'w42' : 'w44'}" style="${widgetSize === '42' ? '' : 'height:470px'}"><div class="sk" style="position:absolute;inset:0;border-radius:0"></div></div>`;

  function widget42(d) {
    const notas = [d.destacada, ...d.titulares].filter(Boolean).slice(0, 4);
    const slides = notas.map((n) => `
      <a class="slide" href="#/nota/${n.id}">${img(n.imagen, n.titulo)}
        <div class="txt"><span class="cat">${kick(n)}</span><h3>${esc(n.titulo)}</h3><span class="meta">Xinhua · ${hace(n.publicado_at)}</span></div></a>`);
    if (d.anuncio) {
      const a = d.anuncio;
      slides.splice(2, 0, `<a class="slide" href="${esc(a.cta_url)}?s=widget42" target="_blank" rel="noopener sponsored" data-ad="${a.id}" data-sup="widget42">${img(a.imagen, a.marca)}
        <div class="txt">${etiquetaAd(a)}<h3>${esc(a.titular || a.marca)}</h3><span class="meta">${esc(a.marca)}</span></div></a>`);
    }
    return `<div class="widget w42">
      <div class="carrusel" id="carr">${slides.join('')}</div>
      <div class="top"><span class="marca">Xi<b>News</b><span class="cn">新华新闻</span></span><span class="vivo"><i></i>EN VIVO</span></div>
      <div class="puntos">${slides.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
    </div>`;
  }
  function startCarrusel() {
    const c = document.getElementById('carr'); if (!c) return;
    const dots = c.parentElement.querySelectorAll('.puntos i');
    const sync = () => { const i = Math.round(c.scrollLeft / c.clientWidth); dots.forEach((d, j) => d.classList.toggle('on', j === i)); };
    c.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timers.push(setInterval(() => {
      const n = dots.length; const i = Math.round(c.scrollLeft / c.clientWidth);
      c.scrollTo({ left: ((i + 1) % n) * c.clientWidth, behavior: 'smooth' });
    }, 7000));
  }
  function widget44(d) {
    const t = d.titulares || [];
    const n = d.destacada;
    const filas = t.slice(0, 3).map((x) => `<a class="fila" href="#/nota/${x.id}">${img(x.miniatura || x.imagen, x.titulo)}<div><span class="cat">${kick(x)}</span><h4>${esc(x.titulo)}</h4></div></a>`);
    if (d.anuncio) {
      const a = d.anuncio;
      filas.splice(2, 0, `<a class="fila patro" href="${esc(a.cta_url)}?s=widget44" target="_blank" rel="noopener sponsored" data-ad="${a.id}" data-sup="widget44">${img(a.imagen, a.marca)}<div>${etiquetaAd(a)}<h4>${esc(a.marca)} · ${esc(a.titular || '')}</h4></div></a>`);
    }
    const ult = t[3] || t[0];
    return `<div class="widget w44">
      <div class="wbar"><span class="marca">Xi<b>News</b><span class="cn">新华新闻</span></span><span class="vivo"><i></i>EN VIVO</span></div>
      ${ult ? `<a class="ultima" href="#/nota/${ult.id}"><span>ÚLTIMA HORA</span><em>${esc(ult.titulo)}</em></a>` : ''}
      ${n ? `<a class="princ" href="#/nota/${n.id}">${img(n.imagen, n.titulo)}<div class="txt"><span class="cat">${kick(n)}</span><h3>${esc(n.titulo)}</h3></div></a>` : ''}
      ${filas.join('')}
      <div class="chips">${['Internacional', 'Ciencia', 'Finanzas', 'Deportes', 'Nacional', 'Viajes'].map((c) => `<a class="chip" href="#/portal/${encodeURIComponent(c)}">${c}</a>`).join('')}</div>
    </div>`;
  }

  // ---------- Portal ----------
  const CATS = ['Portada', 'Internacional', 'Finanzas', 'Ciencia', 'Deportes', 'Cultura y Espectáculos', 'Nacional', 'Viajes'];
  function cabecera(activa) {
    return `<header class="cab">
      <div class="r1"><a href="#/inicio" class="marca" aria-label="Volver a inicio">Xi<b>News</b><span class="cn">新华新闻</span></a>
        <div class="acc"><span class="vivo"><i></i>EN VIVO</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg></div></div>
      <nav class="tabs">${CATS.map((c) => `<a class="tab ${c === activa ? 'on' : ''}" href="#/portal${c === 'Portada' ? '' : '/' + encodeURIComponent(c)}">${c}</a>`).join('')}</nav>
    </header>`;
  }

  async function renderPortal(cat) {
    const activa = cat || 'Portada';
    $app.innerHTML = `<div class="portal">${cabecera(activa)}<div class="sec"><div class="sk" style="height:240px"></div><div class="sk" style="height:90px;margin-top:10px"></div><div class="sk" style="height:90px;margin-top:10px"></div></div></div>`;
    try {
      const q = cat ? `/v1/feed?limit=30&categoria=${encodeURIComponent(cat)}` : '/v1/feed?limit=40';
      const { items } = await api(q);
      const notas = items.filter((i) => i.tipo === 'noticia');
      const ads = items.filter((i) => i.tipo === 'anuncio');
      if (!notas.length) {
        $app.innerHTML = `<div class="portal">${cabecera(activa)}<div class="aviso">Aún no hay notas con foto en esta sección.</div></div>`;
        return;
      }
      let html = `<div class="portal">${cabecera(activa)}`;
      html += `<div class="franja"><span>ÚLTIMA HORA</span><div class="mq"><em>${notas.slice(0, 5).map((n) => esc(n.titulo)).join('  •  ')}</em></div></div>`;
      const [h, s1, s2, ...resto] = notas;
      html += `<section class="sec">
        <a class="card hero" href="#/nota/${h.id}">${img(h.imagen, h.titulo)}<div class="cuerpo"><span class="cat">${kick(h)}</span><h3>${esc(h.titulo)}</h3><p>${esc(h.resumen || '')}</p>${metaNota(h)}</div></a>
        <div class="duo">${[s1, s2].filter(Boolean).map((n) => `<a class="card" href="#/nota/${n.id}">${img(n.miniatura || n.imagen, n.titulo)}<div><span class="cat">${kick(n)}</span><h3>${esc(n.titulo)}</h3></div></a>`).join('')}</div>
      </section>`;
      html += `<section class="sec">${adCard(ads[0], 'portal-1')}</section>`;
      const carr = resto.slice(0, 6);
      if (carr.length) html += `<section class="sec"><h2>Lo más reciente <small>最新</small></h2><div class="carr">${carr.map((n) => `<a class="card" href="#/nota/${n.id}">${img(n.miniatura || n.imagen, n.titulo)}<div><span class="cat">${kick(n)}</span><h3>${esc(n.titulo)}</h3></div></a>`).join('')}</div></section>`;
      const top = resto.slice(6, 11);
      if (top.length) html += `<section class="sec"><h2>Lo más leído <small>热读</small></h2><div class="top5">${top.map((n) => `<a href="#/nota/${n.id}"><h3>${esc(n.titulo)}</h3></a>`).join('')}</div></section>`;
      const lista = resto.slice(11);
      if (lista.length) {
        let k = 1;
        html += `<section class="sec"><h2>Más noticias <small>更多</small></h2><div class="lista">${lista.map((n, i) => {
          let s = `<a class="card mini" href="#/nota/${n.id}">${img(n.miniatura || n.imagen, n.titulo)}<div><span class="cat">${kick(n)}</span><h3>${esc(n.titulo)}</h3>${metaNota(n)}</div></a>`;
          if ((i + 1) % 5 === 0 && ads[k]) s += adCard(ads[k++], 'portal-lista');
          return s;
        }).join('')}</div></section>`;
      }
      html += `<p class="pie-demo">Contenido: Agencia de Noticias Xinhua. Los anuncios marcados como "Ejemplo de pauta" son ilustrativos y no representan campañas contratadas.</p>`;
      if (!stickyClosed && ads[ads.length - 1]) {
        const a = ads[ads.length - 1];
        html += `<div class="sticky-ad" data-ad="${a.id}" data-sup="portal-sticky"><img src="${esc(a.imagen)}" alt="${esc(a.marca)}"><a class="t" href="${esc(a.cta_url)}?s=portal-sticky" target="_blank" rel="noopener sponsored">${etiquetaAd(a)}<strong>${esc(a.marca)} · ${esc(a.titular || '')}</strong></a><button class="x" aria-label="Cerrar anuncio">×</button></div>`;
      }
      html += `</div>`;
      $app.innerHTML = html;
      const x = $app.querySelector('.sticky-ad .x');
      if (x) x.addEventListener('click', () => { stickyClosed = true; x.parentElement.remove(); });
      observeAds();
      track({ tipo: 'apertura', superficie: 'portal' });
    } catch (e) {
      $app.innerHTML = `<div class="portal">${cabecera(activa)}<div class="aviso">No se pudieron cargar las noticias: ${esc(e.message)}</div></div>`;
    }
  }

  // ---------- Nota ----------
  async function renderNota(id) {
    $app.innerHTML = `<article class="nota"><div class="barra"><button onclick="history.length>1?history.back():location.hash='#/portal'"><svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>Volver</button><span class="marca">Xi<b>News</b></span><span></span></div>
      <div class="cab-n"><div class="sk" style="height:26px;width:40%"></div><div class="sk" style="height:70px;margin-top:10px"></div></div><div class="sk" style="height:240px;border-radius:0"></div></article>`;
    try {
      const [n, feed] = await Promise.all([api('/v1/news/' + id), api('/v1/feed?limit=12').catch(() => ({ items: [] }))]);
      track({ tipo: 'vista_nota', noticia_id: n.id, superficie: 'nota' });
      const parrafos = (n.cuerpo_html || '').split(/<\/p>\s*/i).map((p) => p.replace(/<p[^>]*>/i, '').trim()).filter(Boolean)
        .map((p) => p.replace(/<(?!\/?(b|strong|i|em|a)\b)[^>]+>/gi, ''));
      const ads = feed.items.filter((i) => i.tipo === 'anuncio');
      const ad1 = n.anuncio || ads[0];
      let cuerpo = parrafos.map((p, i) => `<p>${p}</p>${i === 1 && ad1 ? adCard(ad1, 'nota-p2') : ''}`).join('');
      if (parrafos.length < 2 && ad1) cuerpo += adCard(ad1, 'nota-p2');
      const rel = feed.items.filter((i) => i.tipo === 'noticia' && i.id !== n.id).slice(0, 4);
      const adRel = ads.find((a) => !ad1 || a.id !== ad1.id) || ads[0];
      const wa = `https://wa.me/?text=${encodeURIComponent(n.titulo + ' · ' + location.origin + location.pathname + '#/nota/' + n.id)}`;
      $app.innerHTML = `<article class="nota">
        <div class="barra"><button onclick="history.length>1?history.back():location.hash='#/portal'"><svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>Volver</button><a href="#/portal" class="marca">Xi<b>News</b></a><span></span></div>
        <div class="cab-n"><span class="cat">${kick(n)}</span><h1>${esc(n.titulo)}</h1>${metaNota(n)}</div>
        <figure class="foto" style="margin:0">${img(n.imagen, n.titulo)}<figcaption><b>${esc(n.credito)}</b>${n.galeria && n.galeria.length > 1 ? ` · Galería de ${n.galeria.length} fotos` : ''}</figcaption></figure>
        <div class="texto">${cuerpo}</div>
        ${n.galeria && n.galeria.length > 1 ? `<section class="sec"><h2>Galería <small>图集</small></h2><div class="galeria">${n.galeria.map((g) => `<figure>${img(g.imagen, g.pie || n.titulo)}<figcaption>${esc(g.pie || '')} <b>(${esc(g.credito)})</b></figcaption></figure>`).join('')}</div></section>` : ''}
        <div class="share"><a class="wa" href="${wa}" target="_blank" rel="noopener">Compartir en WhatsApp</a><a class="orig" href="${esc(n.url)}" target="_blank" rel="noopener">Ver original</a></div>
        <div class="fuente">Fuente: Agencia de Noticias Xinhua. Publicado vía ${esc(new URL(n.url).hostname)}.</div>
        ${rel.length ? `<section class="sec"><h2>Te puede interesar <small>相关</small></h2><div class="lista">${rel.map((r, i) => `${i === 2 && adRel ? adCard(adRel, 'nota-rel') : ''}<a class="card mini" href="#/nota/${r.id}">${img(r.miniatura || r.imagen, r.titulo)}<div><span class="cat">${kick(r)}</span><h3>${esc(r.titulo)}</h3>${metaNota(r)}</div></a>`).join('')}</div></section>` : ''}
      </article>`;
      $app.scrollTop = 0; window.scrollTo(0, 0);
      observeAds();
    } catch (e) {
      $app.innerHTML = `<article class="nota"><div class="barra"><button onclick="location.hash='#/portal'">‹ Volver</button></div><div class="aviso">No se pudo cargar la nota: ${esc(e.message)}</div></article>`;
    }
  }

  // ---------- Router ----------
  function route() {
    clearTimers();
    const h = location.hash.replace(/^#\/?/, '');
    const [r, p] = h.split('/');
    if (r === 'portal') renderPortal(p ? decodeURIComponent(p) : null);
    else if (r === 'nota' && p) renderNota(p);
    else renderInicio();
    $app.scrollTop = 0; window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

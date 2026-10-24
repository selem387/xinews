const { Pool } = require('pg');
const cfg = require('./config');

const pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS noticias_widget (
  id              SERIAL PRIMARY KEY,
  sitio           TEXT NOT NULL,
  wp_id           BIGINT NOT NULL,
  titulo          TEXT NOT NULL,
  resumen         TEXT,
  cuerpo_html     TEXT,
  categoria       TEXT,
  url             TEXT,
  publicado_at    TIMESTAMPTZ,
  foto_wp_url     TEXT,
  foto_wp_ancho   INT,
  foto_wp_alto    INT,
  foto_pie        TEXT,
  foto_credito    TEXT,
  foto_grande_key TEXT,
  foto_grande_at  TIMESTAMPTZ,
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sitio, wp_id)
);
CREATE INDEX IF NOT EXISTS noticias_widget_pub_idx ON noticias_widget (publicado_at DESC);
ALTER TABLE noticias_widget ADD COLUMN IF NOT EXISTS grupo TEXT;
ALTER TABLE noticias_widget ADD COLUMN IF NOT EXISTS titulo_original TEXT;
ALTER TABLE noticias_widget ADD COLUMN IF NOT EXISTS ubicacion TEXT;
CREATE INDEX IF NOT EXISTS noticias_widget_grupo_idx ON noticias_widget (grupo);

CREATE TABLE IF NOT EXISTS anuncios (
  id                 SERIAL PRIMARY KEY,
  marca              TEXT NOT NULL,
  sector             TEXT,
  titular            TEXT,
  producto           TEXT,
  cta_url            TEXT,
  imagen_origen_url  TEXT,
  imagen_key         TEXT,
  formato            TEXT NOT NULL DEFAULT 'nativo',
  etiqueta           TEXT NOT NULL DEFAULT 'Ejemplo de pauta',
  activo             BOOLEAN NOT NULL DEFAULT true,
  prioridad          INT NOT NULL DEFAULT 0,
  creado_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (marca, producto)
);

CREATE TABLE IF NOT EXISTS eventos (
  id          BIGSERIAL PRIMARY KEY,
  tipo        TEXT NOT NULL,
  anuncio_id  INT,
  noticia_id  INT,
  superficie  TEXT,
  sesion      TEXT,
  ua          TEXT,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventos_tipo_idx ON eventos (tipo, creado_at);
`;

async function migrate() {
  await pool.query(SCHEMA);
}

module.exports = { pool, migrate, q: (text, params) => pool.query(text, params) };

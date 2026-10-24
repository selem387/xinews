const {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  HeadBucketCommand, CreateBucketCommand,
} = require('@aws-sdk/client-s3');
const cfg = require('./config');

const s3 = new S3Client({
  endpoint: cfg.s3.endpoint,
  region: cfg.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
});

let ready = false;

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: cfg.s3.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: cfg.s3.bucket }));
  }
  ready = true;
}

let sharp = null;
try { sharp = require('sharp'); } catch { /* sin redimensionado */ }

// Reduce el peso para celular: ancho máximo y WebP. Si falla, guarda el original.
async function optimiza(buffer, contentType, maxWidth) {
  if (!sharp || !maxWidth || !/^image\/(jpeg|png|webp)/.test(contentType || '')) return { buffer, contentType };
  try {
    const out = await sharp(buffer).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return { buffer: out, contentType: 'image/webp' };
  } catch { return { buffer, contentType }; }
}

async function putImage(key, buffer, contentType, maxWidth) {
  const o = await optimiza(buffer, contentType, maxWidth);
  return put(key, o.buffer, o.contentType);
}

async function put(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: cfg.s3.bucket, Key: key, Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=86400',
  }));
  return key;
}

async function get(key) {
  return s3.send(new GetObjectCommand({ Bucket: cfg.s3.bucket, Key: key }));
}

async function del(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: cfg.s3.bucket, Key: key }));
}

// Descarga una imagen remota y la guarda; devuelve la clave
async function putFromUrl(key, url, maxWidth = 1600) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (XiNews image fetcher)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error(`No es imagen (${type}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await putImage(key, buf, type, maxWidth);
  return key;
}

module.exports = { ensureBucket, put, putImage, get, del, putFromUrl, isReady: () => ready };

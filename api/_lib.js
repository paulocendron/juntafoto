/* ============================================================
   JuntaFoto · utilitários do servidor (não é uma rota: começa com "_")
   ============================================================ */
const crypto     = require('crypto');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'vyodkyhe',
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

/* ── Convenções de tags no Cloudinary (a tag do evento vem da configuração: event.tag) ── */
const TAG_HIDDEN   = 'oculta';
const TAG_PENDING  = 'pendente';
const TAG_FEATURED = 'destaque';
const ALBUM_PREFIX = 'album_';

/* ── Configurações editáveis pelo admin (arquivo privado no Cloudinary) ── */
const CONFIG_ID = 'juntafoto_config/config.json';
const DEFAULT_CONFIG = {
  accessPassword: process.env.ACCESS_PASSWORD || 'conexao2026',
  sessionMinutes: 15,
  uploadsOpen:    true,
  moderation:     false,
  defaultAlbum:   '',
  albums:         [], // { id, name, description, hidden, cover }
  framesEnabled:  true,
  hashtags:       '#ConexaoProfissional2026 #SENAIFraiburgo',
  shareCaption:   'Eu fui no Conexão Profissional 2026! 🚀 Finanças, Carreira e Mercado na Prática.',
  // Identidade do evento (o app pode ser reutilizado em outros eventos trocando estes dados)
  event: {
    name:    'Conexão Profissional',
    year:    '2026',
    tagline: 'Finanças, Carreira e Mercado na Prática',
    place:   'SENAI Fraiburgo',
    primary: '#004098',
    accent:  '#E8490F',
    dark:    '#221F1F',
    logoUrl: '',
    tag:     'conexao2026', // as fotos do evento ficam marcadas com esta tag no Cloudinary
  },
  // Molduras disponíveis para os participantes (estilo-base + cores/textos próprios)
  frames: [
    { id: 'classica', name: 'Clássica', base: 'classica', primary: '', accent: '', title: '', subtitle: '', badgeText: 'EU FUI!', enabled: true },
    { id: 'polaroid', name: 'Polaroid', base: 'polaroid', primary: '', accent: '', title: '', subtitle: '', badgeText: 'EU FUI!', enabled: true },
    { id: 'stories',  name: 'Stories',  base: 'stories',  primary: '', accent: '', title: '', subtitle: '', badgeText: 'EU FUI!', enabled: true },
  ],
  adminEmails: [], // vazio: o primeiro login com a senha certa cadastra o e-mail
};

const FRAME_BASES = ['classica', 'polaroid', 'stories'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const color = (v, fallback) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : fallback);
const text  = (v, fallback, max) => String(v ?? fallback).trim().slice(0, max);

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

const REQUIRED_ENV = ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'ADMIN_PASSWORD'];

/* Só os nomes que faltam (nunca os valores) — ajuda a descobrir o que não foi cadastrado na Vercel */
function missingEnv() {
  return REQUIRED_ENV.filter((name) => !String(process.env[name] || '').trim());
}

function isConfigured() {
  return missingEnv().length === 0;
}

/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
async function readConfig() {
  if (!isConfigured()) return { ...DEFAULT_CONFIG };
  const url = cloudinary.utils.private_download_url(CONFIG_ID, '', { resource_type: 'raw', type: 'private' });
  const res = await fetch(url);
  if (res.ok) return normalizeConfig(await res.json());
  // Confirma que o arquivo realmente não existe antes de usar o padrão (evita sobrescrever por engano)
  try {
    await cloudinary.api.resource(CONFIG_ID, { resource_type: 'raw', type: 'private' });
  } catch (err) {
    if (err?.error?.http_code === 404 || err?.http_code === 404) return { ...DEFAULT_CONFIG };
    throw err;
  }
  throw new Error(`Não foi possível ler as configurações (HTTP ${res.status}).`);
}

async function writeConfig(config) {
  const clean = normalizeConfig(config);
  const data  = 'data:application/json;base64,' + Buffer.from(JSON.stringify(clean, null, 2)).toString('base64');
  await cloudinary.uploader.upload(data, {
    resource_type: 'raw',
    type:          'private',
    public_id:     CONFIG_ID,
    overwrite:     true,
    invalidate:    true,
  });
  return clean;
}

function normalizeConfig(c = {}) {
  const albums = Array.isArray(c.albums) ? c.albums : [];
  return {
    accessPassword: String(c.accessPassword || DEFAULT_CONFIG.accessPassword).trim(),
    sessionMinutes: Math.min(240, Math.max(1, parseInt(c.sessionMinutes, 10) || DEFAULT_CONFIG.sessionMinutes)),
    uploadsOpen:    c.uploadsOpen !== false,
    moderation:     !!c.moderation,
    defaultAlbum:   String(c.defaultAlbum || ''),
    framesEnabled:  c.framesEnabled !== false,
    hashtags:       String(c.hashtags ?? DEFAULT_CONFIG.hashtags).trim().slice(0, 120),
    shareCaption:   String(c.shareCaption ?? DEFAULT_CONFIG.shareCaption).trim().slice(0, 500),
    event:          normalizeEvent(c.event),
    frames:         normalizeFrames(c.frames),
    adminEmails:    (Array.isArray(c.adminEmails) ? c.adminEmails : [])
      .map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e)).slice(0, 20),
    albums: albums
      .filter((a) => a && /^[a-z0-9_]{1,40}$/.test(a.id))
      .map((a) => ({
        id:          a.id,
        name:        String(a.name || 'Sem nome').slice(0, 60),
        description: String(a.description || '').slice(0, 300),
        hidden:      !!a.hidden,
        cover:       String(a.cover || ''),
      })),
  };
}

function normalizeEvent(e = {}) {
  const d = DEFAULT_CONFIG.event;
  const tag = String(e.tag || d.tag).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
  return {
    name:    text(e.name, d.name, 60) || d.name,
    year:    text(e.year, d.year, 12),
    tagline: text(e.tagline, d.tagline, 100),
    place:   text(e.place, d.place, 60),
    primary: color(e.primary, d.primary),
    accent:  color(e.accent, d.accent),
    dark:    color(e.dark, d.dark),
    logoUrl: String(e.logoUrl || '').startsWith('https://res.cloudinary.com/') ? String(e.logoUrl).slice(0, 400) : '',
    tag:     tag || d.tag,
  };
}

function normalizeFrames(list) {
  const frames = (Array.isArray(list) ? list : DEFAULT_CONFIG.frames)
    .filter((f) => f && /^[a-z0-9_]{1,40}$/.test(f.id))
    .slice(0, 24)
    .map((f) => ({
      id:        f.id,
      name:      text(f.name, 'Moldura', 40) || 'Moldura',
      base:      FRAME_BASES.includes(f.base) ? f.base : 'classica',
      primary:   color(f.primary, ''),
      accent:    color(f.accent, ''),
      title:     text(f.title, '', 60),
      subtitle:  text(f.subtitle, '', 100),
      badgeText: text(f.badgeText, 'EU FUI!', 14) || 'EU FUI!',
      enabled:   f.enabled !== false,
    }));
  return frames.length ? frames : DEFAULT_CONFIG.frames.map((f) => ({ ...f }));
}

function publicConfig(c) {
  const albums = c.albums.filter((a) => !a.hidden).map(({ id, name, description, cover }) => ({ id, name, description, cover }));
  return {
    sessionMinutes: c.sessionMinutes,
    uploadsOpen:    c.uploadsOpen,
    moderation:     c.moderation,
    defaultAlbum:   albums.some((a) => a.id === c.defaultAlbum) ? c.defaultAlbum : '',
    framesEnabled:  c.framesEnabled,
    hashtags:       c.hashtags,
    shareCaption:   c.shareCaption,
    event:          c.event,
    frames:         c.frames.filter((f) => f.enabled).map(({ enabled, ...f }) => f),
    albums,
  };
}

/* ============================================================
   FOTOS
   ============================================================ */
function parsePhoto(r) {
  const ctx  = r.context?.custom || r.context || {};
  const tags = r.tags || [];
  return {
    id:        r.public_id,
    url:       r.secure_url,
    width:     r.width,
    height:    r.height,
    bytes:     r.bytes,
    createdAt: r.created_at,
    author:    safeDecode(ctx.author) || 'Participante',
    caption:   ctx.caption || '',
    owner:     /^[0-9a-f]{64}$/.test(ctx.owner || '') ? ctx.owner : '', // impressão digital (SHA-256) da chave do aparelho que enviou
    angle:     parseInt(ctx.angle, 10) || 0,
    hidden:    tags.includes(TAG_HIDDEN),
    pending:   tags.includes(TAG_PENDING),
    featured:  tags.includes(TAG_FEATURED),
    albums:    tags.filter((t) => t.startsWith(ALBUM_PREFIX)).map((t) => t.slice(ALBUM_PREFIX.length)),
  };
}

/* Fotos antigas gravavam o autor com encodeURIComponent ("Jo%C3%A3o") */
function safeDecode(value) {
  if (!value || !/%[0-9A-Fa-f]{2}/.test(value)) return value || '';
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

/* Busca as fotos do evento (tag = config.event.tag) */
async function searchPhotos(eventTag, expression, { cursor, maxResults = 60 } = {}) {
  let q = cloudinary.search
    .expression(`resource_type:image AND tags=${eventTag}${expression ? ' AND ' + expression : ''}`)
    .sort_by('created_at', 'desc')
    .max_results(maxResults)
    .with_field('context')
    .with_field('tags');
  if (cursor) q = q.next_cursor(cursor);
  const r = await q.execute();
  return { photos: (r.resources || []).map(parsePhoto), nextCursor: r.next_cursor || null, total: r.total_count || 0 };
}

/* ============================================================
   AUTENTICAÇÃO DO ADMIN (token assinado, sem estado no servidor)
   ============================================================ */
function tokenKey() {
  return `${process.env.ADMIN_PASSWORD}:${process.env.CLOUDINARY_API_SECRET}`;
}

function createToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac('sha256', tokenKey()).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

function verifyToken(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const expected = crypto.createHmac('sha256', tokenKey()).update(exp).digest('hex');
  return safeEqual(sig, expected);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/* ============================================================
   RESPOSTAS
   ============================================================ */
function sendError(res, err, status = 500) {
  const msg = err?.error?.message || err?.message || String(err);
  console.error('[juntafoto]', msg);
  res.status(err?.error?.http_code || err?.http_code || status).json({ error: msg });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Impressão digital da chave secreta do participante (a chave em si nunca fica guardada no servidor) */
function ownerHash(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

module.exports = {
  ownerHash, parsePhoto,
  cloudinary, TAG_HIDDEN, TAG_PENDING, TAG_FEATURED, ALBUM_PREFIX,
  isConfigured, missingEnv, readConfig, writeConfig, normalizeConfig, publicConfig,
  searchPhotos, createToken, verifyToken, safeEqual, sendError, sleep,
};

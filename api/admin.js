/* POST /api/admin { action, ... } — todas as operações do painel do administrador */
const {
  cloudinary, EVENT_TAG, TAG_HIDDEN, TAG_PENDING, TAG_FEATURED, ALBUM_PREFIX,
  isConfigured, readConfig, writeConfig, searchPhotos,
  createToken, verifyToken, safeEqual, sendError, sleep,
} = require('./_lib');

const MAX_LIST     = 3000; // limite de fotos carregadas no painel
const ALLOWED_TAGS = [TAG_HIDDEN, TAG_PENDING, TAG_FEATURED];

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function cleanIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw Object.assign(new Error('Nenhuma foto informada.'), { http_code: 400 });
  return ids.map(String).filter((id) => id && !id.includes('..'));
}

function isAllowedTag(tag) {
  return ALLOWED_TAGS.includes(tag) || /^album_[a-z0-9_]{1,40}$/.test(tag);
}

const actions = {
  /* Lista todas as fotos do evento (inclusive ocultas e pendentes) + configurações */
  async list() {
    const photos = [];
    let cursor;
    do {
      const r = await searchPhotos('', { cursor, maxResults: 500 });
      photos.push(...r.photos);
      cursor = r.nextCursor;
    } while (cursor && photos.length < MAX_LIST);
    return { photos, config: await readConfig(), truncated: !!cursor };
  },

  /* Uso da conta Cloudinary (armazenamento, créditos) */
  async usage() {
    const u = await cloudinary.api.usage();
    return {
      plan:      u.plan,
      storage:   u.storage?.usage || 0,
      bandwidth: u.bandwidth?.usage || 0,
      credits:   u.credits ? { used: u.credits.usage, limit: u.credits.limit, percent: u.credits.used_percent } : null,
      resources: u.resources,
    };
  },

  /* Edita autor, legenda e rotação (mescla com o que já existe) */
  async update({ ids, author, caption, angle }) {
    ids = cleanIds(ids);
    const ctx = {};
    if (author  !== undefined) ctx.author  = String(author).trim().slice(0, 40) || 'Participante';
    if (caption !== undefined) ctx.caption = String(caption).trim().slice(0, 300);
    if (angle   !== undefined) ctx.angle   = String(((parseInt(angle, 10) || 0) % 360 + 360) % 360);
    if (Object.keys(ctx).length === 0) return { ok: true };
    for (const part of chunk(ids, 1000)) await cloudinary.uploader.add_context(ctx, part);
    return { ok: true };
  },

  /* Adiciona/remove marcações: oculta, pendente, destaque e álbuns */
  async tags({ ids, add = [], remove = [] }) {
    ids = cleanIds(ids);
    for (const tag of [...add, ...remove]) {
      if (!isAllowedTag(tag)) throw Object.assign(new Error(`Marcação inválida: ${tag}`), { http_code: 400 });
    }
    for (const part of chunk(ids, 1000)) {
      for (const tag of remove) await cloudinary.uploader.remove_tag(tag, part);
      for (const tag of add)    await cloudinary.uploader.add_tag(tag, part);
    }
    return { ok: true };
  },

  /* Exclui fotos definitivamente */
  async delete({ ids }) {
    ids = cleanIds(ids);
    let deleted = 0;
    for (const part of chunk(ids, 100)) {
      const r = await cloudinary.api.delete_resources(part, { invalidate: true });
      deleted += Object.values(r.deleted || {}).filter((v) => v === 'deleted').length;
    }
    return { ok: true, deleted };
  },

  /* Salva configurações e álbuns */
  async saveConfig({ config }) {
    return { config: await writeConfig(config) };
  },

  /* Gera link de download .zip (fotos selecionadas, um álbum ou o evento todo) */
  async zip({ ids, album, name }) {
    const opts = { resource_type: 'image', flatten_folders: true, target_public_id: String(name || 'fotos-conexao2026').replace(/[^\w-]/g, '_') };
    if (Array.isArray(ids) && ids.length) opts.public_ids = cleanIds(ids);
    else if (album)                       opts.tags = [`${ALBUM_PREFIX}${album}`];
    else                                  opts.tags = [EVENT_TAG];
    return { url: cloudinary.utils.download_zip_url(opts) };
  },
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Painel não configurado. Cadastre CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET e ADMIN_PASSWORD na Vercel.',
      notConfigured: true,
    });
  }

  const { action, ...body } = req.body || {};
  try {
    if (action === 'login') {
      if (!safeEqual(String(body.password || ''), process.env.ADMIN_PASSWORD)) {
        await sleep(800);
        return res.status(401).json({ error: 'Senha de administrador incorreta.' });
      }
      return res.status(200).json({ token: createToken() });
    }

    if (!verifyToken(req)) return res.status(401).json({ error: 'Sessão do admin expirada. Entre novamente.', expired: true });
    if (!actions[action])  return res.status(400).json({ error: `Ação desconhecida: ${action}` });

    res.status(200).json(await actions[action](body));
  } catch (err) {
    sendError(res, err);
  }
};

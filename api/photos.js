/* GET /api/photos?album=<id>&featured=1&cursor=<c> — fotos visíveis na galeria pública */
const { isConfigured, readConfig, searchPhotos, TAG_HIDDEN, TAG_PENDING, TAG_FEATURED, ALBUM_PREFIX, sendError } = require('./_lib');

module.exports = async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Servidor não configurado (variáveis do Cloudinary na Vercel).' });
  }
  try {
    const config = await readConfig();
    const parts  = [`NOT tags=${TAG_HIDDEN}`, `NOT tags=${TAG_PENDING}`];
    // Fotos de álbuns ocultos também não aparecem
    config.albums.filter((a) => a.hidden).forEach((a) => parts.push(`NOT tags=${ALBUM_PREFIX}${a.id}`));

    const album = String(req.query.album || '');
    if (album && /^[a-z0-9_]+$/.test(album)) parts.push(`tags=${ALBUM_PREFIX}${album}`);
    if (req.query.featured === '1') parts.push(`tags=${TAG_FEATURED}`);

    const result = await searchPhotos(parts.join(' AND '), { cursor: req.query.cursor || undefined });
    // Cache curto na CDN da Vercel: protege o limite de chamadas do Cloudinary com muita gente olhando
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
    res.status(200).json(result);
  } catch (err) {
    sendError(res, err);
  }
};

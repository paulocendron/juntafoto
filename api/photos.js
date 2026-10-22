/* GET /api/photos?album=<id>&featured=1&cursor=<c> — fotos visíveis na galeria pública */
const { isConfigured, readConfig, searchPhotos, TAG_FEATURED, ALBUM_PREFIX, sendError } = require('./_lib');

const MIN_PER_PAGE  = 30; // junta páginas do Cloudinary até ter pelo menos isso de fotos visíveis
const MAX_SCANS     = 5;  // limite de buscas por requisição (protege a cota do Cloudinary)

module.exports = async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Servidor não configurado (variáveis do Cloudinary na Vercel).' });
  }
  try {
    const config       = await readConfig();
    const hiddenAlbums = new Set(config.albums.filter((a) => a.hidden).map((a) => a.id));

    // A busca do Cloudinary falha com mais de uma exclusão ("-tags=a AND -tags=b"),
    // então a consulta só usa tags positivas e as fotos ocultas/pendentes são filtradas aqui.
    const parts = [];
    const album = String(req.query.album || '');
    if (album && /^[a-z0-9_]+$/.test(album)) parts.push(`tags=${ALBUM_PREFIX}${album}`);
    if (req.query.featured === '1') parts.push(`tags=${TAG_FEATURED}`);

    const photos = [];
    let cursor = req.query.cursor || undefined;
    let scans  = 0;
    do {
      const r = await searchPhotos(config.event.tag, parts.join(' AND '), { cursor, maxResults: 100 });
      photos.push(...r.photos.filter((p) => !p.hidden && !p.pending && !p.albums.some((a) => hiddenAlbums.has(a))));
      cursor = r.nextCursor;
      scans++;
    } while (cursor && photos.length < MIN_PER_PAGE && scans < MAX_SCANS);

    // Cache curto na CDN da Vercel: protege o limite de chamadas do Cloudinary com muita gente olhando
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
    res.status(200).json({ photos, nextCursor: cursor || null });
  } catch (err) {
    sendError(res, err);
  }
};

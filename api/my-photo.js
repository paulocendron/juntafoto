/* POST /api/my-photo { id, secret } — o participante exclui UMA foto que ele mesmo enviou.
   Só apaga se SHA-256(secret) for igual à impressão digital gravada na foto (context.owner)
   e se a foto for do evento atual. Fotos de outras pessoas são recusadas. */
const { cloudinary, isConfigured, readConfig, parsePhoto, ownerHash, safeEqual, sendError, sleep } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!isConfigured()) return res.status(503).json({ error: 'Servidor não configurado.' });

  const id     = String(req.body?.id || '');
  const secret = String(req.body?.secret || '');
  if (!id || id.includes('..') || secret.length < 32) return res.status(400).json({ error: 'Pedido inválido.' });

  const denied = async () => { await sleep(500); return res.status(403).json({ error: 'Você só pode excluir as fotos que você enviou.' }); };
  try {
    let resource;
    try {
      resource = await cloudinary.api.resource(id, { context: true, tags: true });
    } catch (err) {
      if (err?.error?.http_code === 404) return res.status(404).json({ error: 'Esta foto não existe mais.' });
      throw err;
    }
    const { event } = await readConfig();
    const photo = parsePhoto(resource);
    if (!(resource.tags || []).includes(event.tag)) return denied();
    if (!photo.owner || !safeEqual(photo.owner, ownerHash(secret))) return denied();

    await cloudinary.api.delete_resources([id], { invalidate: true });
    res.status(200).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
};

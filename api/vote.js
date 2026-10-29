/* POST /api/vote { action: 'vote' | 'unvote', id, slot, secret } — voto nas 2 fotos favoritas.
   Cada aparelho tem 2 vagas (slot 0 e 1). Votar põe a tag da vaga na foto com "set_exclusive":
   o Cloudinary tira essa tag de qualquer outra foto, então ninguém passa de 2 votos — sem precisar
   ler nada antes (não gasta a cota da API de administração). */
const { cloudinary, isConfigured, readConfig, VOTE_SLOTS, voteTag, voterIdFromSecret, sendError } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!isConfigured()) return res.status(503).json({ error: 'Servidor não configurado.' });

  const { action, id, slot, secret } = req.body || {};
  const s = Number(slot);
  if (!['vote', 'unvote'].includes(action) || typeof id !== 'string' || !id || id.includes('..') || id.length > 200
      || !Number.isInteger(s) || s < 0 || s >= VOTE_SLOTS || !/^[0-9a-f]{64}$/.test(String(secret || ''))) {
    return res.status(400).json({ error: 'Pedido inválido.' });
  }

  try {
    const config = await readConfig();
    if (!config.votingOpen) return res.status(403).json({ error: 'A votação está encerrada.', closed: true });

    const tag = voteTag(config.votingRound, s, voterIdFromSecret(secret));
    if (action === 'vote') await cloudinary.uploader.add_tag(tag, [id], { exclusive: true });
    else                   await cloudinary.uploader.remove_tag(tag, [id]);
    res.status(200).json({ ok: true, round: config.votingRound });
  } catch (err) {
    sendError(res, err);
  }
};

/* POST /api/access { password } — confere a palavra-chave do evento (fica só no servidor) */
const { readConfig, sleep, sendError } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const config = await readConfig();
    const input  = String(req.body?.password || '').trim().toLowerCase();
    const ok     = input !== '' && input === config.accessPassword.toLowerCase();
    if (!ok) await sleep(600); // dificulta tentativas em sequência
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok });
  } catch (err) {
    sendError(res, err);
  }
};

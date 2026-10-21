/* GET /api/config — configurações públicas (álbuns, envios abertos, moderação, tempo de sessão) */
const { readConfig, publicConfig, sendError } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const config = await readConfig();
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
    res.status(200).json(publicConfig(config));
  } catch (err) {
    sendError(res, err);
  }
};

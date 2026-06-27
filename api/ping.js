// Diagnostico: endpoint sin dependencias externas
module.exports = async (req, res) => {
  return res.status(200).json({ ok: true, msg: 'ping ok', ts: Date.now() });
};

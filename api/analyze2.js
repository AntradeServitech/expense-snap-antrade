// Endpoint de diagnostico temporal - borrar tras confirmar
module.exports = async (req, res) => {
  return res.status(200).json({ ok: true, method: req.method, route: 'analyze2' });
};

// DIAGNOSTIC BUILD - minimal handler to test Vercel function invocation
module.exports = async (req, res) => {
  return res.status(200).json({ ok: true, method: req.method, version: 'diag-01' });
};

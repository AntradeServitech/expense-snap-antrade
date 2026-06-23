// GET /api/projects
// Lista los proyectos activos (crm.lead con x_serial_antrade) para el selector de la PWA.
const { searchRead } = require('./_lib/odoo');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const leads = await searchRead(
      'crm.lead',
      [['x_serial_antrade', '!=', false], ['active', '=', true]],
      ['id', 'name', 'x_serial_antrade', 'x_analytic_account_id'],
      { order: 'x_serial_antrade desc' }
    );

    const projects = leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      serial: lead.x_serial_antrade,
      x_serial_antrade: lead.x_serial_antrade,
      analytic_account_id: lead.x_analytic_account_id ? lead.x_analytic_account_id[0] : null,
    }));

    res.status(200).json({
      projects: [
        { id: null, name: 'Gasto general', serial: null, x_serial_antrade: null, analytic_account_id: null },
        ...projects,
      ],
    });
  } catch (err) {
    console.error('Error /api/projects:', err.message);
    res.status(500).json({ error: 'No se pudo conectar con Odoo', detail: err.message });
  }
};

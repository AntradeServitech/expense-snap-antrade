// POST /api/submit
// Crea el hr.expense en Odoo + adjunta la imagen como ir.attachment.
// Solo se llama tras la confirmación explícita del usuario en la pantalla de revisión.
const { execute, searchRead, create } = require('./_lib/odoo');

// Mapeo categoría -> product.product (creados el 2026-06-23, confirmado con el usuario).
// IDs en Odoo: Restauracion=96, Alojamiento=97, Transporte=98, Combustible=99, Oficina=100, Gastos varios=101
const CATEGORY_TO_PRODUCT_ID = {
  restaurant: 96,
  hotel: 97,
  transport: 98,
  fuel: 99,
  office: 100,
  other: 101,
};

const COMPANY_ID = 1; // Antrade Servitech SL

async function resolveEmployeeId() {
  const { ODOO_USER } = require('./_lib/odoo').getEnv();
  const byEmail = await searchRead('hr.employee', [['work_email', '=', ODOO_USER]], ['id'], { limit: 1 });
  if (byEmail.length) return byEmail[0].id;

  const users = await searchRead('res.users', [['login', '=', ODOO_USER]], ['id'], { limit: 1 });
  if (users.length) {
    const byUser = await searchRead('hr.employee', [['user_id', '=', users[0].id]], ['id'], { limit: 1 });
    if (byUser.length) return byUser[0].id;
  }
  throw new Error(`No se encontró una ficha de empleado en Odoo para ${ODOO_USER}`);
}

async function resolveCurrencyId(isoCode) {
  const matches = await searchRead('res.currency', [['name', '=', isoCode]], ['id', 'active'], { limit: 1 });
  if (!matches.length) {
    throw new Error(`La moneda ${isoCode} no existe en Odoo. Gestiónala manualmente.`);
  }
  const currency = matches[0];
  if (!currency.active) {
    await execute('res.currency', 'write', [[currency.id], { active: true }]);
  }
  return currency.id;
}

async function resolveAnalyticDistribution(projectId) {
  if (!projectId) return false;
  const leads = await searchRead('crm.lead', [['id', '=', projectId]], ['x_analytic_account_id'], { limit: 1 });
  const analyticAccount = leads[0]?.x_analytic_account_id;
  if (!analyticAccount) return false;
  return { [String(analyticAccount[0])]: 100 };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { merchant, amount, currency, date, category, description, project_id, image, mimeType } = req.body || {};

  if (!merchant || !amount || !date || !currency) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (establecimiento, importe, fecha o moneda)' });
  }

  const productId = CATEGORY_TO_PRODUCT_ID[category] || CATEGORY_TO_PRODUCT_ID.other;

  try {
    const [employeeId, currencyId, analyticDistribution] = await Promise.all([
      resolveEmployeeId(),
      resolveCurrencyId(currency),
      resolveAnalyticDistribution(project_id),
    ]);

    const expenseId = await create('hr.expense', {
      name: description || merchant,
      employee_id: employeeId,
      product_id: productId,
      total_amount: amount,
      quantity: 1,
      currency_id: currencyId,
      date,
      analytic_distribution: analyticDistribution,
      company_id: COMPANY_ID,
      payment_mode: 'own_account',
    });

    if (image && mimeType) {
      await create('ir.attachment', {
        name: `ticket_${expenseId}.${mimeType.split('/')[1] || 'jpg'}`,
        res_model: 'hr.expense',
        res_id: expenseId,
        datas: image,
        mimetype: mimeType,
      });
    }

    const { ODOO_URL } = require('./_lib/odoo').getEnv();
    res.status(200).json({
      success: true,
      expense_id: expenseId,
      odoo_url: `${ODOO_URL}/odoo/expenses/${expenseId}`,
      odoo_expenses_url: `${ODOO_URL}/odoo/expenses`,
    });
  } catch (err) {
    console.error('Error /api/submit:', err.message);
    res.status(500).json({ error: 'No se pudo crear el gasto en Odoo', detail: err.message });
  }
};

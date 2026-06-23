# Expense Snap - Antrade

PWA mobile-first para capturar tickets/recibos desde el móvil y cargarlos automáticamente
como gastos (`hr.expense`) en Odoo Enterprise saas~19.3 de **Antrade Servitech SL**
(antrade-servitech.odoo.com).

## Stack

- **Frontend**: PWA vanilla (HTML/CSS/JS), instalable, funciona offline con cola de pendientes.
- **Backend**: Vercel Serverless Functions (Node.js, `/api/*`).
- **OCR**: Google Cloud Vision API (`images:annotate`, `TEXT_DETECTION`/`DOCUMENT_TEXT_DETECTION`).
- **Estructuración del texto a JSON**: Claude API (`claude-sonnet-4-6`, solo texto, sin imagen) —
  **opcional**: si `ANTHROPIC_API_KEY` no está configurada o la llamada falla (p.ej. sin saldo),
  `api/analyze.js` cae automáticamente a un parser heurístico por regex (menor precisión, pero la
  app nunca falla solo por falta de esa key). Cambio de stack del 23/06/2026 — antes se usaba
  Claude Vision directamente sobre la imagen.
- **Odoo**: XML-RPC (paquete npm `xmlrpc`), helper compartido en `api/_lib/odoo.js`.
- **Supabase**: reservado para v2 (almacenamiento de imágenes / cola offline persistente). No usado en v1.

## Credenciales y entorno

Todas las credenciales viven en variables de entorno (`.env` local / Vercel dashboard en producción).
**Nunca hardcodear credenciales en el código.** Ver `.env.example` para la lista completa.

- `ODOO_URL=https://antrade-servitech.odoo.com`
- `ODOO_DB=antrade-servitech`
- `ODOO_USER=j.guzman@antradeservitech.com` (o el email del usuario que despliega su propia instancia)
- `ODOO_PASSWORD=` (API key de Odoo, ver `/AntradeERP/odoo_client.py` y `/AntradeERP/config.py` para la referencia local de Jesús — NUNCA copiar ese valor a un archivo versionado)
- `GOOGLE_VISION_API_KEY=` (obligatoria — OCR del ticket)
- `ANTHROPIC_API_KEY=` (opcional — mejora la estructuración del texto OCR a JSON; sin ella se usan heurísticas)

Cada persona que despliega su propia instancia de la PWA (p.ej. Jesús, Adriana) usa **sus propias**
`ODOO_USER`/`ODOO_PASSWORD` en su proyecto de Vercel. El backend usa ese email para resolver el
`hr.employee` correspondiente (ver "Identidad del empleado" más abajo) — no hay pantalla de login en la PWA.

## Restricción crítica

**NUNCA escribir en Odoo sin confirmación explícita del usuario en la pantalla de revisión
(Pantalla 2 → botón "✓ Confirmar y subir a Odoo").** `api/submit.js` solo se invoca tras ese clic.

## Estructura del proyecto

```
ExpenseSnap/
├── api/
│   ├── _lib/odoo.js   ← cliente XML-RPC compartido (auth + execute + searchRead + create)
│   ├── analyze.js      ← POST: Google Vision (OCR) + Claude opcional (estructurar) + heurísticas
│   ├── submit.js       ← POST: crea hr.expense + ir.attachment en Odoo
│   └── projects.js     ← GET: lista crm.lead activos con x_serial_antrade
├── public/             ← PWA (index.html, app.js, styles.css, manifest.json, sw.js, icons/)
├── scripts/make_icons.py ← generador de los iconos PNG (Pillow)
├── vercel.json
└── .env.example
```

## Decisiones de datos en Odoo (Paso 5 — confirmadas con el usuario el 2026-06-23)

Al construir la app se encontró que Odoo no tenía los datos necesarios para el flujo. Con
confirmación explícita del usuario se hicieron estos cambios **en producción**:

1. **Productos de gasto creados** (`product.template`/`product.product`, `can_be_expensed=True`,
   `type=service`, `uom_id=Units`, `purchase_ok=True`, `sale_ok=False`):

   | Categoría (Claude) | Producto Odoo   | product_id |
   |---------------------|------------------|-----------|
   | restaurant          | Restauracion     | 96        |
   | hotel               | Alojamiento      | 97        |
   | transport           | Transporte       | 98        |
   | fuel                | Combustible      | 99        |
   | office               | Oficina         | 100       |
   | other                | Gastos varios   | 101       |

   Este mapeo está hardcodeado en `api/submit.js` (`CATEGORY_TO_PRODUCT_ID`). Si se renombran o
   eliminan estos productos en Odoo, hay que actualizar ese objeto.

2. **Identidad del empleado**: en Odoo solo existía 1 ficha `hr.employee` (Jesús Guzmán) sin
   `work_email`. Se le añadió `work_email=j.guzman@antradeservitech.com` y `user_id`. `api/submit.js`
   resuelve el `employee_id` buscando `hr.employee.work_email = ODOO_USER` (con fallback por
   `res.users.login` → `hr.employee.user_id`). **Cada nueva persona que use la app necesita una
   ficha `hr.employee` con `work_email` igual a su `ODOO_USER`**, si no, `/api/submit` devuelve error.

3. **Monedas**: solo EUR estaba activa en Odoo. `api/submit.js` activa automáticamente
   (`active=True`) cualquier `res.currency` existente pero inactiva cuando Claude detecta esa
   divisa en un ticket. Es una acción reversible y no destructiva, aprobada explícitamente por el
   usuario para no bloquear el flujo en cada ticket en moneda extranjera.

4. **Proyecto → cuenta analítica (LIMITACIÓN CONOCIDA, sin resolver)**: `crm.lead.x_analytic_account_id`
   es el campo que debería usarse para construir `analytic_distribution`
   (`{"<analytic_account_id>": 100}`) en el `hr.expense`, pero al probarlo (23/06/2026) está **vacío
   (`False`) en los 6 leads activos actuales**, y `crm.lead.project_ids` (relación a
   `project.project`, que sí trae `account_id` de serie) también está vacío. Las cuentas analíticas
   existentes (`account.analytic.account` ids 1-4) parecen nombrarse a mano siguiendo el código de
   serial del proyecto, pero con prefijos inconsistentes (`P-`, `O-`, `ET-`), así que **no se intentó
   adivinar el emparejamiento por texto** — el riesgo de asignar el coste al proyecto equivocado es
   peor que no asignarlo. `api/submit.js` crea el `hr.expense` con `analytic_distribution=false`
   cuando no encuentra `x_analytic_account_id` poblado (el gasto se crea igualmente, solo sin reparto
   analítico). **Pendiente**: que Jesús/Adriana confirmen cuál es el mecanismo real de Odoo que
   vincula un lead/proyecto con su cuenta analítica en este sistema, para implementar la resolución
   correcta.

## Notas de implementación

- `api/analyze.js` y `api/submit.js` reciben JSON (`{ image: <base64 sin prefijo>, mimeType }`),
  **no** `multipart/form-data`: el frontend ya redimensiona/comprime la imagen a JPEG (máx. 1600px,
  calidad 0.82) con `<canvas>` antes de enviarla, así evitamos depender de un parser multipart en
  funciones serverless y nos mantenemos por debajo del límite de tamaño de body de Vercel.
- El service worker (`public/sw.js`) nunca cachea `/api/*`; solo cachea assets estáticos. Si falla
  el envío por falta de red, el gasto se guarda en `localStorage` (`expenseSnap.pendingExpenses`) y
  se reintenta automáticamente al recuperar conexión (`window.addEventListener('online', ...)`).
- `hr.expense` en saas~19.3 ya no usa `analytic_account_id` (many2one) sino `analytic_distribution`
  (campo JSON). No usar el nombre de campo antiguo.

## Restricciones globales (no tocar sin permiso explícito)

- No instalar módulos nuevos en Odoo.
- No tocar automatizaciones existentes (`base.automation`) ni vistas/acciones de otros módulos.
- No modificar `/AntradeERP/odoo_client.py` ni `/AntradeERP/config.py` (son del proyecto Python
  separado; ExpenseSnap solo los usó como referencia de credenciales/conexión).

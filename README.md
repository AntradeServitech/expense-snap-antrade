# Expense Snap - Antrade

PWA para capturar tickets/recibos desde el móvil y registrarlos automáticamente como gastos
(`hr.expense`) en Odoo (Antrade Servitech SL). Ver [CLAUDE.md](./CLAUDE.md) para el contexto
técnico completo, decisiones de datos en Odoo y limitaciones conocidas.

**Producción (cuenta de Jesús)**: https://antrade-expensesnap.vercel.app
Proyecto Vercel: `antrade/antrade-expensesnap` (team `antrade`). Repo GitHub: pendiente de que
Jesús haga el push inicial a `AntradeServitech/expense-snap-antrade` (ver instrucciones más abajo).

## Deploy en Vercel

1. **Clonar/subir el repositorio.** Este proyecto (`ExpenseSnap/`) debe subirse a un repo de
   GitHub propio (no mezclarlo con el resto de `AntradeERP/`, que no es un repo Git).
2. **Crear el proyecto en Vercel**: "Add New Project" → importar el repo de GitHub.
   - Root Directory: la carpeta donde está este `package.json` (si el repo es solo `ExpenseSnap/`,
     déjalo en blanco).
3. **Configurar las variables de entorno** en *Project Settings → Environment Variables* (ver lista
   abajo). Cada persona que despliegue su propia instancia (Jesús, Adriana, etc.) usa **sus propias**
   `ODOO_USER`/`ODOO_PASSWORD`, porque la app no tiene pantalla de login: el backend identifica al
   empleado buscando en Odoo el `hr.employee` cuyo `work_email` coincide con `ODOO_USER`.
4. **Deploy.** Cada push a la rama principal despliega automáticamente.
5. Abre la URL de Vercel desde el móvil y usa "Añadir a pantalla de inicio" (Android/Chrome) o
   "Compartir → Añadir a pantalla de inicio" (iOS/Safari) para instalarla como PWA.

### Variables de entorno a configurar en Vercel (para el deploy de Adriana / cualquier usuario)

| Variable | Descripción | Ejemplo |
|---|---|---|
| `ODOO_URL` | URL base de la instancia Odoo | `https://antrade-servitech.odoo.com` |
| `ODOO_DB` | Nombre de la base de datos Odoo | `antrade-servitech` |
| `ODOO_USER` | Email/login Odoo de la persona que usará esta instancia | `a.navarro@antrade.net` |
| `ODOO_PASSWORD` | API key de Odoo de esa persona (Settings → My Profile → Account Security → API Keys) | — |
| `GOOGLE_VISION_API_KEY` | API key de Google Cloud Vision (OCR del ticket) — **obligatoria** | — |
| `ANTHROPIC_API_KEY` | API key de Anthropic — **opcional**, estructura el texto OCR en JSON con más precisión; sin ella se usa un parser heurístico (regex) | — |
| `SUPABASE_URL` | (Reservado para v2, no usado todavía) | — |
| `SUPABASE_ANON_KEY` | (Reservado para v2, no usado todavía) | — |

**Importante**: cada usuario nuevo necesita además una ficha `hr.employee` en Odoo con `work_email`
igual a su `ODOO_USER`, o `/api/submit` devolverá error al no poder resolver el empleado.

## Desarrollo local

```bash
npm install
cp .env.example .env   # y rellena los valores reales (no se sube a git)
node scripts/test_pipeline.js   # prueba api/projects.js y api/submit.js sin necesitar `vercel dev`
# o, para servir también el frontend:
npx vercel dev
```

## Seguridad

- No hay credenciales hardcodeadas en el código: todo se lee de `process.env` (ver `api/_lib/odoo.js`
  y `api/analyze.js`). `.env` está en `.gitignore`.
- `api/submit.js` solo se invoca tras la confirmación explícita del usuario en la pantalla de
  revisión de la PWA — nunca se sube nada a Odoo automáticamente.
- Las cabeceras de seguridad (CSP, X-Frame-Options, etc.) están configuradas en `vercel.json`.

## Estado de las pruebas (23/06/2026)

- ✅ `GET /api/projects` — conecta a Odoo y devuelve los 6 proyectos activos (`x_serial_antrade`)
  + "Gasto general".
- ✅ `POST /api/submit` — probado con un ticket sintético de prueba: creó
  `hr.expense` id **1** (`[PRUEBA ExpenseSnap - borrar] Comida en restaurante La Marina, Vigo`,
  16,00 EUR, producto "Restauracion") y el `ir.attachment` (id 904) quedó correctamente vinculado
  (`res_model='hr.expense'`, `res_id=1`). **Pendiente**: borra o conserva ese gasto de prueba desde
  Odoo según prefieras.
- ✅ `POST /api/analyze` — probado de extremo a extremo con `GOOGLE_VISION_API_KEY` real
  (`scripts/test_analyze.js`): el OCR de Google Vision extrajo correctamente el texto del ticket
  sintético. La estructuración con Claude falló por falta de saldo en esa cuenta de Anthropic y el
  endpoint cayó automáticamente al parser heurístico (`structured_by: "heuristics"`), que igualmente
  extrajo bien los 5 campos clave (merchant, amount, currency, date, category). Confirma que el
  fallback funciona en un caso real, no solo en el test unitario aislado.
  **Nota**: con tickets reales más desordenados, la heurística será menos precisa que Claude — si se
  quiere la máxima fiabilidad conviene recargar saldo en la cuenta de Anthropic.
- ⚠️ Reparto por cuenta analítica de proyecto: limitación conocida, ver [CLAUDE.md](./CLAUDE.md)
  punto 4 — los gastos se crean correctamente pero sin `analytic_distribution` hasta resolver cómo
  se vincula realmente cada proyecto con su cuenta analítica en este Odoo.

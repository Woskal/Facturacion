# Sistema de gestión y punto de venta — Venezuela

Producto SaaS para micronegocios venezolanos: punto de venta, inventario,
clientes, gastos y reportes, con manejo bimonetario Bs/USD de primera clase.

## Estado

**Fase 0 — Cimientos.** Completa.

- [x] Monorepo y configuración de TypeScript
- [x] `@fve/money` — núcleo monetario con su suite de tests
- [x] Esquema de base de datos y aislamiento multi-tenant
- [x] Autenticación y sesiones revocables

**Fase 1 — Núcleo transaccional.** En curso.

- [x] Tasa del día con histórico
- [x] Emisión y anulación de ventas
- [x] Alta de negocios y cuentas por el operador
- [x] Catálogo, inventario, clientes y cartera
- [x] Cierre de caja y arqueo
- [ ] API HTTP
- [ ] Interfaz web

Ninguna pantalla de negocio se escribe antes de que el núcleo monetario esté
cubierto por tests. El resto del sistema descansa sobre él.

## Quién es quién

**El operador de la plataforma** —quien vende el servicio— da de alta negocios y
les asigna cuentas. Es una condición de la persona, no un rol dentro de un
negocio, y no le da acceso automático a los datos de nadie: para entrar a un
negocio hay que tener membresía en él, y crearla queda en su bitácora. El poder
existe, pero deja rastro.

El primer operador se crea con un script que corre en el servidor, porque solo
un operador puede nombrar a otro:

```bash
npm run bootstrap-admin --workspace=@fve/core -- correo@ejemplo.ve "Nombre"
```

**El usuario de un negocio** puede hacer de todo dentro del suyo.
No hay roles ni matriz de permisos: con un solo rol, cualquier comprobación
devolvería siempre lo mismo. Lo que separa a un usuario de otro no es su rol
sino su negocio, y de eso se encarga la seguridad por fila de Postgres.

La tabla `memberships` y la columna `role` se conservan como la costura por
donde entrarán más usuarios y más roles cuando haga falta.

## Alcance fiscal

Este sistema **no es el emisor fiscal**. Emite documentos de gestión —
presupuesto, nota de entrega, recibo, nota de crédito — mientras el documento
fiscal lo produce la máquina fiscal o la imprenta autorizada del cliente. Es la
práctica dominante del mercado y evita la homologación en el MVP.

La capa de documentos está diseñada para que enchufar más adelante una impresora
fiscal, una imprenta digital homologada o la homologación propia
(SNAT/2024/000121) sea un adaptador y no una reescritura. Por eso la
inmutabilidad de documentos, el consecutivo inviolable y la bitácora de auditoría
entran desde la Fase 0, aunque todavía no hagan falta.

Normativa de referencia: Providencia 0071, SNAT/2024/000102 (Gaceta 43.032,
19-dic-2024) y SNAT/2024/000121.

## Estructura

```
docs/
  dominio-venezuela.md   Hallazgos de campo sobre el dominio y la competencia
packages/
  money/                 Núcleo monetario: Bs/USD, tasa BCV, IVA, IGTF, pagos mixtos
  db/                    Esquema, migraciones y aislamiento entre negocios
  auth/                  Autenticación y sesiones opacas revocables
  core/                  Operaciones de negocio: tasa, ventas, inventario, cartera
```

## Entorno de desarrollo

- Node.js 24 LTS
- PostgreSQL 17 en `localhost:5432`
- Base `fve_dev`, propiedad del rol `fve_app`

El rol `fve_app` **no es superusuario, y no debe serlo nunca**: un superusuario
ignora las políticas de seguridad por fila y el aislamiento entre negocios
desaparecería sin que nada falle a la vista. Hay un test que lo verifica.

Las contraseñas de esta máquina (`postgres` para el superusuario, `fve_dev` para
la aplicación) son locales y desechables: **no deben usarse en ningún entorno
real.**

Para preparar la base desde cero:

```bash
psql -U postgres -c "CREATE ROLE fve_app LOGIN PASSWORD 'fve_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE" -c "CREATE DATABASE fve_dev OWNER fve_app"
```

```bash
npm run migrate --workspace=@fve/db
```

## Reglas que no se negocian

1. Todo monto es `bigint` en unidades menores. Nunca `number`, nunca float.
2. Todo redondeo es explícito y pasa por `divideRound`.
3. Todo monto se persiste junto a la tasa con que se calculó. Un histórico jamás
   se reconstruye con la tasa de hoy.
4. El IVA se guarda desglosado en alícuota principal y adicional, como lo pide el
   libro de ventas. La suntuaria es 16% + 15%, no 31%.
5. El IGTF grava el pago en divisa, no la venta, y va en línea aparte del IVA.
6. Las alícuotas son parámetros, no constantes: cambian por decreto.

## Desarrollo

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

# Sistema de gestión y punto de venta — Venezuela

Producto SaaS para micronegocios venezolanos: punto de venta, inventario,
clientes, gastos y reportes, con manejo bimonetario Bs/USD de primera clase.

## Estado

**Fase 0 — Cimientos.** Completa.

- [x] Monorepo y configuración de TypeScript
- [x] `@fve/money` — núcleo monetario con su suite de tests
- [x] Esquema de base de datos y aislamiento multi-tenant
- [x] Autenticación y sesiones revocables

**Fase 2 — Sin conexión.** Completa.

- [x] Reserva de bloques de numeración por caja
- [x] Catálogo, tasa y cola de ventas guardados en el navegador
- [x] Sincronización automática al volver la conexión
- [x] Aplicación instalable

La caja guarda catálogo, tasa y un bloque de números apartados mientras hay
internet. Al cortarse, sigue vendiendo con esos números y deja las ventas en
cola; al volver la conexión suben solas, con el momento real de cada una y no
el de la sincronización.

Una venta sincronizada solo puede declarar su propia fecha si trae número
reservado —prueba de que la caja estuvo desconectada— y dentro de treinta días
hacia atrás, nunca hacia el futuro. Sin ese límite, la fecha de un documento
fiscal quedaría a discreción del cliente.

**Fase 1 — Núcleo transaccional.** Completa.

- [x] Tasa del día con histórico y sincronización automática del BCV
- [x] Emisión y anulación de ventas
- [x] Alta de negocios y cuentas por el operador
- [x] Catálogo, inventario, clientes y cartera
- [x] Cierre de caja y arqueo
- [x] API HTTP
- [x] Interfaz web: venta, catálogo, clientes, caja y panel del operador
- [x] Reportes y libro de ventas

Ninguna pantalla de negocio se escribe antes de que el núcleo monetario esté
cubierto por tests. El resto del sistema descansa sobre él.

## Cobro del servicio

Un negocio nuevo arranca con quince días de prueba que empiezan solos. El pago
se registra a mano —pago móvil, Zelle, USDT, transferencia— porque en Venezuela
no hay pasarela que cobre sola; queda con su referencia y quién lo dio por
bueno.

Quien vence entra primero en un período de gracia y solo se suspende si lo pasa.
El pago es manual y tarda: cortarle el servicio a alguien que ya transfirió pero
cuyo comprobante nadie revisó es la forma más rápida de perder un cliente.

Suspender no borra nada. Los datos siguen ahí para cuando el cliente se ponga al
día.

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
apps/
  api/                   API HTTP sobre Fastify
  web/                   Interfaz web: venta, catálogo, clientes, caja y panel
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

Los tests hablan con una base **separada** para no tocar los datos de desarrollo:
correr `npm test` sobre la base de desarrollo la truncaría. Cree la base de
pruebas, migre ambas y déjela declarada en `packages/db/.env` como
`TEST_DATABASE_URL`; los tests la toman de ahí.

```bash
psql -U postgres -c "CREATE DATABASE fve_test OWNER fve_app"
```

```bash
DATABASE_URL=postgres://fve_app:fve_dev@localhost:5432/fve_test npm run migrate --workspace=@fve/db
```

La API lee su configuración de `apps/api/.env` (copie `apps/api/.env.example`).
Para tener un negocio de ejemplo con el que recorrer la aplicación —productos, un
proveedor con su compra, un talonario cargado y unas ventas, incluida una factura
con número de control— siembre la demo (VACÍA la base que apunte `DATABASE_URL`):

```bash
npm run seed-demo --workspace=@fve/core
```

Entra con `cajero@demo.ve` / `clavecajero12`.

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

Levantar la API:

```bash
npm run dev --workspace=@fve/api
```

Levantar la interfaz (usa la API por proxy en `/api`):

```bash
npm run dev --workspace=@fve/web
```

## Tasa del BCV

El precio se ancla en dólares y se cobra en bolívares a la tasa del BCV, que la
API mantiene al día sola cada hora (`BCV_SYNC_MINUTES` para cambiarlo,
`BCV_SYNC=off` para apagarlo). La tasa se obtiene de **dolarapi**
(`ve.dolarapi.com`, JSON estable) y, si ese origen se cae, se raspa la página del
propio BCV como respaldo — así una caída de un origen no deja al negocio sin
tasa nueva.

Tres reglas de esa sincronización:

1. La tasa se guarda bajo su **fecha valor**, no la de publicación. El BCV
   publica un día la que regirá el siguiente día bancario.
2. **Nunca pisa una tasa cargada a mano.** Quien la corrigió sabía algo que el
   proceso automático no sabe.
3. Un salto mayor al 50% se rechaza y se avisa, en vez de aplicarse solo. No es
   desconfianza del BCV: es que un cambio en la forma de su página no meta un
   número disparatado en cada venta del día.

Si el BCV no responde, el negocio sigue vendiendo con la última tasa conocida.
Una caja detenida porque un sitio web está caído sería peor que el problema que
resuelve.

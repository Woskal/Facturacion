# Plan de mejoras — después del MVP

Este plan continúa el del README. Las Fases 0, 1 y 2 (cimientos, núcleo
transaccional y modo sin conexión) están completas, y sobre ellas ya se
agregaron **factura con número de control, proveedores y compras, ganancia con
costo, presupuesto sin cobro, anulación desde la interfaz y edición de clientes
y productos** — todo con pruebas y verificado contra base real.

Lo que sigue son las piezas que faltan para pasar de "MVP que funciona" a
"producto que un negocio venezolano usa sin buscar otra cosa". El orden es por
retorno: primero lo que tiene los cimientos puestos y cierra huecos del día a
día; el hardware fiscal —lo más grande— queda para cuando se busque validez
fiscal real. Cada fase dice qué se hace, por qué (anclado en
[dominio-venezuela.md](dominio-venezuela.md)), qué cimiento ya existe, el tamaño
aproximado y cuándo se da por hecha.

Regla que no cambia: todo monto sigue siendo un par Bs/USD con su tasa, en una
sola tabla, con importes históricos que nunca se recalculan con la tasa de hoy.

---

## Fase 3 — Higiene técnica

**Objetivo:** poder iterar sin romper la demo ni depender de pasos manuales.

- Base de datos **separada para pruebas** (`fve_test`), para que `npm test` deje
  de truncar la base de desarrollo. Hoy correr los tests borra los datos.
- **`.env` de `apps/api`** (y un `.env.example`), para que la API arranque con
  `npm run dev` sin pasar `DATABASE_URL` a mano.
- **Script de siembra de demo** versionado (`packages/core/scripts/seed-demo.ts`)
  en vez del temporal, para levantar un negocio de ejemplo cuando haga falta.
- Sacar del repo el harness de previsualización (`apps/web/preview.*`) o moverlo
  a un lugar claramente de desarrollo.
- Un `runbook` corto: cómo levantar todo de cero en una máquina nueva.

**Cimiento:** el esquema, las migraciones y el `bootstrap-admin` ya existen.
**Tamaño:** chico. **Hecho cuando:** `npm test` no toca la demo y `npm run dev`
de la API arranca sin variables a mano.

---

## Fase 4 — Cierre del ciclo comercial

**Objetivo:** que entren y salgan documentos con su contraparte, no a medias.

- **Cuentas por pagar a proveedores.** El espejo de la cobranza: saldo por pagar
  por compra y registro de pagos al proveedor.
- **Nota de crédito guiada.** Emitir una nota de crédito a partir de una factura
  (devolución total o parcial), que reponga inventario y ajuste la cuenta. Es el
  complemento fiscal de "Anular", que ya existe.
- **Historial del cliente** en su ficha (documentos y saldos).
- **Gastos.** Alta y listado de gastos, para que la ganancia refleje el negocio
  completo y no solo el margen de la mercancía.

**Por qué:** Valery modela cuentas por pagar y retenciones como entidades de
primera clase; sin la contraparte, la contabilidad del negocio no cuadra.
**Cimiento:** `purchases` ya existe; `NOTA_CREDITO` es un tipo de documento con
su serie ya creada; `GET /customers/:id/history` ya está en la API; la tabla
`expenses` ya está en el esquema. **Tamaño:** mediano. **Hecho cuando:** se puede
pagar una compra, devolver una factura con nota de crédito, y ver el gasto en el
reporte.

---

## Fase 5 — Contribuyente especial: retenciones

**Objetivo:** operar con clientes y proveedores que retienen IVA/ISLR sin
descuadrarse.

- **Comprobante de retención de IVA** que el cliente contribuyente especial
  entrega: registrarlo (ya se puede como abono) y **generarlo/imprimirlo** con su
  formato y correlativo.
- **Retención de ISLR**, con sus conceptos.
- **Retención a proveedores**: cuando el propio negocio es agente de retención y
  retiene al pagar.

**Por qué:** el dominio lo marca como no-opcional para quien le vende a un
especial —"le van a retener y tiene que registrarlo o su cuenta por cobrar nunca
cuadra"—. **Cimiento:** la cartera ya acepta abonos por `RETENTION_IVA` y
`RETENTION_ISLR` desde el día uno; falta el comprobante y el lado del proveedor.
**Tamaño:** mediano. **Hecho cuando:** un cobro con retención genera su
comprobante y la cuenta por cobrar queda saldada por el par pago + retención.

---

## Fase 6 — Flexibilidad comercial

**Objetivo:** vender a distintos precios como se vende de verdad.

- **Listas de precios** (detal y mayor) por producto.
- **Precio especial por cliente** o por lista asignada al cliente.
- **Presupuesto → venta**: convertir una cotización en factura o nota de entrega
  con un clic, sin recapturar.

**Por qué:** "detal, mayor, especial por cliente" es muy común en el mercado.
**Cimiento:** el esquema ya tiene `price_lists` y `product_prices` como relación
—se dejó así a propósito para no migrar ventas al agregar precios—; hoy se usa
una sola lista. **Tamaño:** mediano. **Hecho cuando:** un producto puede tener
precio detal y mayor, y una venta toma el que corresponde al cliente.

---

## Multiusuario y roles — descartado

Decisión (2026-08-31): **no se hace.** El producto apunta a negocios pequeños con
una sola caja y un solo teléfono, donde una persona hace todo. No hay varios
usuarios por negocio, así que roles y permisos serían maquinaria muerta. La
recuperación de contraseña se maneja fuera del sistema: quien la pierde acude al
operador de la plataforma, que la reasigna. La tabla `memberships` y su columna
`role` se conservan como están, por si esto cambia, pero no se construye.

---

## Fase 7 — Reportería avanzada

**Objetivo:** que el dueño lea su negocio de un vistazo.

- Gráficas de ventas y ganancia en el tiempo.
- Reporte de **compras y gastos**, no solo de ventas.
- Más exportaciones (además del libro de ventas en CSV).
- Rentabilidad por proveedor y por cliente.

**Cimiento:** los reportes ya leen importes históricos persistidos; `profitReport`
ya cruza venta y costo. **Tamaño:** chico-mediano por reporte. **Hecho cuando:**
hay al menos una vista con gráfica y un reporte de compras/gastos.

---

## Fase 8 — Validez fiscal (impresora fiscal)

**Objetivo:** emitir el documento fiscal ante el SENIAT, no solo el
administrativo.

- **Adaptador de impresora fiscal**: The Factory HKA (`tfhkaif.dll`), Bematech
  (con su firmware, incluida la variante IGTF), interfaz genérica (`winfis32`),
  Rigazsa/Netsoft.
- Tolerar un parque de impresoras con firmwares distintos conviviendo.
- Alternativa: imprenta digital homologada u homologación propia
  (SNAT/2024/000121).

**Por qué:** es el salto de "sistema administrativo" a "emisor fiscal", y el
mayor diferenciador. **Cimiento:** la capa de documentos se diseñó desde la Fase
0 para que enchufar esto sea un adaptador y no una reescritura —inmutabilidad,
consecutivo inviolable, bitácora—. **Tamaño:** grande (integración con hardware y
homologación). **Hecho cuando:** una factura sale por una máquina fiscal real con
su número de control fiscal.

---

## Fase 9 — Multi-sucursal (opcional, en duda)

**En revisión:** el producto se posiciona para negocios de una sola caja, así que
esta fase probablemente no entre. Se deja documentada por si un cliente crece y la
pide; no se construye salvo que se decida cambiar el posicionamiento.

**Objetivo:** varios locales/cajas bajo un mismo negocio.

- Varias estaciones y sucursales de primera clase.
- Sincronización diferida entre sucursales (paquetes enviados/recibidos), sobre
  lo que ya se hizo para una caja sin conexión.
- Depósitos y ubicaciones de inventario.

**Por qué:** en Venezuela la sincronización diferida es estructural, no un lujo.
**Cimiento:** las estaciones y los bloques de numeración por caja ya existen; el
offline de una caja ya funciona. **Tamaño:** grande. **Hecho cuando:** dos cajas
del mismo negocio operan y concilian sin pisarse la numeración.

---

## Fuera de alcance por ahora

Vistas en Valery pero que no entran todavía: productos compuestos y terminados
con partes, seriales, ofertas y promociones, comisiones por vendedor, zonas de
venta, contabilidad con integración de comprobantes, conciliación bancaria.
Ninguna se descarta; simplemente no compite en retorno con lo de arriba.

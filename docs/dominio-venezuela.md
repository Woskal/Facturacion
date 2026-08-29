# Modelo de dominio venezolano — hallazgos de campo

Notas de investigación sobre cómo se modela realmente un sistema administrativo
en Venezuela, extraídas de dos referencias: [Vento](https://ventoapp.co)
(Colombia, gestión moderna sin validez fiscal) y **Valery Professional**
(Venezuela, líder del mercado, Delphi + Firebird 2.5).

**Límite:** de Valery se extrae conocimiento de dominio — qué entidades existen,
qué exige el SENIAT, qué hardware hay que soportar, dónde su diseño envejeció
mal. No se copia su código, su esquema ni sus reportes.

---

## 1. El hallazgo principal: la moneda extranjera está atornillada

Valery tiene, en paralelo a casi cada tabla del negocio, una tabla gemela con
sufijo `_ME` (moneda extranjera): ventas y su gemela de ventas en ME, detalles de
venta y su gemela, cuentas por cobrar y su gemela, cuentas por pagar y la suya.

Eso es la firma inconfundible de un sistema **diseñado para una sola moneda al
que le agregaron la divisa años después**. Todo cálculo, todo reporte y toda
consulta tiene que acordarse de mirar dos sitios, y cada función nueva hay que
escribirla dos veces.

**Consecuencia para nosotros:** confirma la apuesta del plan. El bimonetario no
es un módulo ni una tabla auxiliar — es el tipo de dato. Un monto es un par
Bs/USD con su tasa, siempre, en una sola tabla. Es exactamente el terreno donde
el líder del mercado carga una deuda técnica que no puede pagar sin reescribirse,
y donde un producto nuevo empieza con ventaja estructural.

Es también el motivo por el que `@fve/money` se escribió antes que cualquier
pantalla.

---

## 2. Hardware fiscal que hay que soportar

Las bibliotecas de impresora fiscal que incluye Valery marcan el estándar de
facto del mercado:

| Biblioteca | Fabricante |
|---|---|
| `tfhkaif.dll` | The Factory HKA |
| `winfis32.dll` | Interfaz fiscal genérica |
| `rigazsaNetsoft.dll` | Rigazsa / Netsoft |
| Firmware Bematech `V01.00.00`, `V01.00.19`, `V01.00.22-igtf` | Bematech |

El detalle revelador es que existe una versión de firmware **específica para
IGTF**: el impuesto obligó a cambiar el firmware de las máquinas, no solo el
software. Un parque de impresoras conviviendo con firmwares distintos es la
realidad del mercado, y el adaptador de impresora fiscal tendrá que tolerarlo.

---

## 3. Requisitos que el plan no contemplaba

Del modelo de Valery salen piezas del negocio venezolano que no estaban en el
alcance y que hay que decidir conscientemente, no por olvido.

**Retenciones de IVA e ISLR.** Valery tiene entidades dedicadas a retenciones de
clientes y de proveedores, conceptos de retención de ISLR, y tres formatos de
comprobante de retención de IVA. Un contribuyente especial retiene el 75% o el
100% del IVA al pagar. Para un micronegocio que *vende* a un contribuyente
especial, esto no es opcional: le van a retener y tiene que registrarlo o su
cuenta por cobrar nunca cuadra.
→ **Decisión: fuera del MVP, pero la cuenta por cobrar debe admitir un abono por
retención desde el día uno.** Si no, se descuadra y no hay parche barato.

**Reserva de números de control.** Existe una entidad dedicada a la lista de
números de control reservados, separada de la numeración de documentos. Es
precisamente el mecanismo que necesita nuestra operación offline.
→ **Confirma el diseño de Fase 2.** El número de control lo asigna la imprenta o
la máquina fiscal, y el sistema administra bloques reservados por estación.

**Estaciones.** El sistema modela terminales como entidad de primera clase.
→ Necesario para los bloques de numeración por terminal, aunque el MVP sea de una
sola caja.

**Listas de precios múltiples.** Detal, mayor, especial por cliente.
→ Muy común en el mercado. **Fuera del MVP**, pero el precio del producto no debe
ser una columna suelta: debe poder volverse una relación sin migrar ventas.

**Desglose de impuestos persistido.** El desglose por alícuota y los totales de
IVA se guardan como filas propias del documento, no se recalculan al consultar.
→ **Confirma la decisión de `computeTotals`:** el desglose se persiste con el
documento. Recalcularlo años después con otro código o con otras alícuotas daría
un número distinto al que se imprimió.

**Historial de estados por entidad.** Casi cada tabla tiene su tabla de estados,
y hay tablas espejo de auditoría por módulo completo.
→ **Confirma el requisito de inmutabilidad y bitácora de la Fase 0.**

**Sincronización entre sucursales por paquetes.** Valery mueve paquetes enviados
y recibidos entre servidores.
→ La sincronización diferida no es una peculiaridad nuestra: en Venezuela es una
necesidad estructural. Refuerza que el offline de Fase 2 no es un lujo.

**Otras piezas vistas, todas fuera del MVP:** depósitos y ubicaciones, productos
compuestos y terminados con partes, seriales, ofertas y promociones, comisiones
por vendedor, zonas de venta, contabilidad con integración de comprobantes,
conciliación bancaria.

---

## 4. Qué tomamos de cada referencia

**De Vento** — la forma comercial: un solo plan plano con usuarios ilimitados,
descuento por período y no por funciones, ocho módulos y ni uno más, prueba
gratis con conversión por defecto.

**De Valery** — la forma del dominio: qué entidades existen de verdad en un
negocio venezolano, qué exige el SENIAT, qué hardware hay en la calle, y sobre
todo dónde duele su arquitectura.

**De ninguno de los dos** — el modelo monetario. Vento asume una moneda; Valery
la atornilló al lado. Ahí es donde el producto se gana el derecho a existir.

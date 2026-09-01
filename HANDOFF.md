# Traspaso — Sistemas de Facturación

Documento para retomar el proyecto en **otra máquina / otra sesión de Claude**.
Lo escribió Claude al final de una sesión larga, a pedido del dueño, porque la
memoria del asistente vive fuera del repositorio (`~/.claude/...`) y **no viaja
con GitHub**. Aquí está consolidado todo lo que hace falta para continuar sin
perder el hilo.

Última actualización: **2026-09-01**. Rama principal: `main`.

---

## 1. Qué es el proyecto

SaaS **multi-tenant** de facturación para Venezuela (repo `facturacion-ve`).

- Una cuenta **operador de la plataforma** (el dueño) da de alta negocios. Cada
  negocio es un **sandbox aislado** mediante Row Level Security (RLS) de Postgres.
- Cada negocio = una empresa con sus datos, y sus documentos salen personalizados.
- Documentos: presupuesto, nota de entrega, recibo, nota de crédito y **factura**.
  El sistema **no** es emisor fiscal ante el SENIAT: imprime sobre forma libre de
  imprenta autorizada, de donde sale el **número de control**. La validez fiscal
  con impresora fiscal es la Fase 8, **diferida** (ver §4).
- Bimonetario **Bs/USD** con **tasa BCV automática** (fuente: dolarapi, con
  raspado del BCV como respaldo).

Monorepo TypeScript:

| Paquete/App | Rol |
|---|---|
| `@fve/money` | Núcleo monetario exacto: Bs/USD en `bigint`, tasa (escala 1e8), IVA, IGTF, pagos mixtos |
| `@fve/db` | Esquema Drizzle, migraciones y **aislamiento entre negocios (RLS)** |
| `@fve/auth` | Sesiones opacas revocables, `argon2` |
| `@fve/core` | Operaciones de negocio: tasa, ventas, inventario, cartera, compras, reportes |
| `@fve/api` | HTTP en Fastify |
| `@fve/web` | Interfaz React + Vite + Tailwind v4 |

Módulos que existen: clientes, productos/catálogo, ventas + búsqueda, caja/arqueo,
cobranza, **proveedores/compras**, **cuentas por pagar**, **gastos**,
**retenciones recibidas**, **listas de precios**, reportes de ventas/ganancia (con
costo) y panel del operador.

---

## 2. Estado actual — dónde quedamos

**MVP + todo el plan post-MVP están completos y en `main`, salvo la Fase 8
(impresora fiscal), que se difirió hasta tener hardware.** El multiusuario/roles se
**descartó** (el producto apunta a negocios de una sola caja).

Resumen fase por fase (detalle y decisiones en
[`docs/plan-mejoras.md`](docs/plan-mejoras.md)):

- **Rediseño de la web** — hecho: sistema de diseño nuevo, shell con barra lateral
  oscura, pulido en todas las páginas.
- **Facturas** — hechas: número de control, config del emisor, talonario,
  impresión en formato carta y ticket 80mm.
- **Proveedores / compras** — hechos: directorio + registro de compras que suma
  inventario.
- **Fase 3 (higiene técnica)** — hecha: base de tests separada `fve_test`,
  `apps/api/.env`, siembra versionada `seed-demo`, runbook en README.
- **Fase 4 (cierre del ciclo comercial)** — hecha: cuentas por pagar, historial del
  cliente, gastos y **nota de crédito guiada** (guarda totales en **negativo** para
  que el libro de ventas/ganancia/top-productos la resten solos; repone inventario;
  devolución **total**, la parcial queda como mejora futura).
- **Fase 5 (retenciones)** — hecha con alcance acotado: se registra la retención
  IVA/ISLR que aplica el **cliente** (exige N° de comprobante y salda la cuenta) y
  hay reporte de **retenciones recibidas**. **Generar** comprobantes a proveedores
  queda fuera (el negocio objetivo no suele ser contribuyente especial).
- **Fase 6 (flexibilidad comercial)** — hecha: listas de precios (detal/mayor) y
  **convertir presupuesto → venta** con un clic.
- **Fase 7 (reportería avanzada)** — hecha: **gráfica de ventas por día**, KPI de
  compras del período, ganancia por producto. La siembra ahora usa la **tasa real
  del BCV** (antes Bs 84 fijo parecía congelada).
- **Mejora tasa dolarapi** — hecha: `fetchRate` usa `ve.dolarapi.com` primero y el
  raspado del BCV como respaldo; el job de sync y `/rates/sync` la usan.

Último commit al escribir esto: `62fdf16 docs: Fase 8 (impresora fiscal) diferida`.
Corré `git log --oneline -20` para ver el detalle.

Pruebas: **~400 pasan, 0 fallos** contra Postgres real (`fve_test`).

---

## 3. Cómo levantar todo en una máquina nueva

El runbook completo está en el [`README.md`](README.md) (sección «Entorno de
desarrollo»). Resumen:

1. **Requisitos:** Node.js 24 LTS y **PostgreSQL 17** en `localhost:5432`.
2. **Instalar dependencias:**
   ```bash
   npm install
   ```
3. **Crear el rol de aplicación y las bases** (el rol **no** es superusuario):
   ```bash
   psql -U postgres -c "CREATE ROLE fve_app LOGIN PASSWORD 'fve_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE" -c "CREATE DATABASE fve_dev OWNER fve_app"
   psql -U postgres -c "CREATE DATABASE fve_test OWNER fve_app"
   ```
4. **Recrear los `.env`** (están gitignoreados; cópialos de los `.example`):
   - `packages/db/.env` ← `packages/db/.env.example`. Debe tener `DATABASE_URL`
     (apuntando a `fve_dev`, con el rol `fve_app`) y `TEST_DATABASE_URL`
     (apuntando a `fve_test`); los tests toman esta última de ahí.
   - `apps/api/.env` ← `apps/api/.env.example`.
5. **Migrar ambas bases:**
   ```bash
   npm run migrate --workspace=@fve/db
   DATABASE_URL=postgres://fve_app:fve_dev@localhost:5432/fve_test npm run migrate --workspace=@fve/db
   ```
6. **Sembrar la demo** (VACÍA la base que apunte `DATABASE_URL` y la rellena):
   ```bash
   npm run seed-demo --workspace=@fve/core
   ```
7. **Verificar:**
   ```bash
   npm test
   npm run typecheck
   ```

### Cómo correrlo

Dos terminales:

```bash
npm run dev --workspace=@fve/api    # API (puerto 3001)
```
```bash
npm run dev --workspace=@fve/web    # Web en http://localhost:5173 (proxy /api → API)
```

Entrar al navegador en **http://localhost:5173**:

- Negocio (cajero): `cajero@demo.ve` / `clavecajero12`
- Operador de la plataforma: `operador@demo.ve` / `claveoperador1`

---

## 4. Decisiones vigentes (no re-litigar sin el dueño)

- **Fase 8 (impresora fiscal): DIFERIDA.** No hay hardware fiscal; no se construye
  a ciegas. Se retoma cuando haya una impresora concreta, anclando el trabajo a su
  marca/modelo/SDK (The Factory HKA, Bematech, etc.). El sistema queda como
  **administrativo**, que es el alcance acordado.
- **Multiusuario / roles: DESCARTADO.** Negocios de una sola caja; una persona hace
  todo. La recuperación de contraseña se maneja fuera del sistema: quien la pierde
  **acude al operador**, que la reasigna. Las tablas `memberships`/`role` se
  conservan por si cambia, pero no se construye encima.
- **Retención a proveedores (generar comprobantes): FUERA** por ahora (mismo motivo
  que multiusuario).
- **Multi-sucursal (Fase 9): en duda**, probablemente no entra por el
  posicionamiento de una sola caja.

---

## 5. Gotchas y notas técnicas

- **Reiniciar la API tras tocar el core.** La API corre con `tsx` (sin watch): si
  cambiás `@fve/core` o `@fve/api`, matá el proceso del puerto 3001 y relanzá, o
  seguirá ejecutando el código viejo. (Este fue el origen de un falso
  `UnsettledSaleError` al emitir presupuestos: la API tenía core viejo.)
- **Base de tests separada.** Los tests corren contra `fve_test`
  (`TEST_DATABASE_URL`), así que `npm test` **ya no** borra la demo de `fve_dev`.
  La configuración de vitest de cada paquete sustituye `DATABASE_URL` por
  `TEST_DATABASE_URL` si existe.
- **RLS al agregar tablas por-negocio.** Toda tabla nueva con datos de un negocio
  debe: (a) agregarse a `TENANT_SCOPED_TABLES` en `packages/db/src/tenancy.ts`, y
  (b) recibir políticas RLS en su migración. `fve_app` es **no superusuario** a
  propósito; si lo hicieras superusuario, el aislamiento se rompe en silencio.
- **Migraciones (Drizzle).** `drizzle-kit generate` diffea snapshots (necesita
  `DATABASE_URL`, no una base viva). Las políticas RLS se **agregan a mano** al SQL
  generado. Nota histórica: el snapshot 0010 se escribió a mano y quedó
  desincronizado; por eso 0011 se editó a mano para contener solo
  proveedores/compras. El head (`0011_snapshot.json`) sí refleja el esquema
  completo, así que los `generate` futuros diferencian bien.
- **Serialización.** Fastify tiene un serializador global (`serializeBigInts`):
  `bigint`→string, `Date`→ISO, `Money`→`{currency, amount:string}`.
- **Nota de crédito.** `createCreditNote` copia el documento original **negado** y
  a su **misma tasa**, para que los reportes lo resten al sumar. No se puede
  acreditar dos veces; se enlaza por `relatedDocumentId`.

---

## 6. Qué sigue (ideas priorizadas, sin empezar)

Cuando el dueño quiera seguir, esto es lo que estaba sobre la mesa (de mayor a
menor retorno):

1. **Despliegue de producción**: entorno real (Postgres gestionado, secretos por
   variables de entorno, **nunca** los `.env` locales), respaldos automáticos.
2. **Importar productos desde Excel** para migrar catálogos de Valery.
3. **Aviso de stock por debajo de cero / mínimo** al vender.
4. **Pruebas end-to-end** (navegador) de los flujos críticos.
5. Endurecimiento de la API (límites, validación de bordes) y accesibilidad.
6. Diferidos: **Fase 8 (impresora fiscal)** cuando haya hardware; nota de crédito
   **parcial**; multi-sucursal si cambia el posicionamiento.

Todo lo pendiente, con su porqué, está en
[`docs/plan-mejoras.md`](docs/plan-mejoras.md) y
[`docs/dominio-venezuela.md`](docs/dominio-venezuela.md).

---

## 7. Sobre «tener todo el chat»

El historial literal de la conversación no cabe aquí y no viaja con el repo, pero
**este documento + `CLAUDE.md` + `git log` + `docs/`** reconstruyen todas las
decisiones y el estado. Si en la máquina original todavía existe la memoria de
Claude (`~/.claude/projects/D--Proyectos-Sistemas-De-Facturacion/memory/`), ahí
está el detalle fino; en la máquina nueva, empezá por `CLAUDE.md` (se carga solo) y
por este archivo.

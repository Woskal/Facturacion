# Contexto del proyecto — Sistemas de Facturación (facturacion-ve)

> Este archivo lo carga Claude Code automáticamente al abrir el proyecto.
> **Si es tu primera vez en esta máquina, lee [`HANDOFF.md`](HANDOFF.md) completo:**
> ahí está la historia, el estado y cómo levantar todo de cero. La memoria del
> chat vive fuera del repo (en `~/.claude/...`), así que **no viaja con GitHub**;
> `HANDOFF.md` es la fuente de verdad del contexto.

## Qué es

SaaS **multi-tenant** de facturación para Venezuela. Un **operador de la
plataforma** (el dueño) da de alta negocios; cada negocio es un **sandbox
aislado** vía Row Level Security de Postgres. Cada negocio emite presupuesto,
nota de entrega, recibo, nota de crédito y **factura** (imprime sobre forma libre
de imprenta autorizada, de donde sale el número de control; **no** es emisor
fiscal ante el SENIAT — eso es la Fase 8, diferida). Bimonetario Bs/USD con tasa
BCV automática.

Monorepo TypeScript. Paquetes: `@fve/money`, `@fve/db` (Drizzle + RLS),
`@fve/auth`, `@fve/core`. Apps: `@fve/api` (Fastify), `@fve/web` (React + Vite +
Tailwind v4).

## Estado (2026-09-01)

MVP + plan post-MVP **completos y en `main`**, salvo la Fase 8 (impresora fiscal),
diferida hasta tener hardware. Multiusuario/roles **descartado** (negocios de una
sola caja). El plan y su detalle están en [`docs/plan-mejoras.md`](docs/plan-mejoras.md).
Para el estado fase por fase y dónde quedamos, ver [`HANDOFF.md`](HANDOFF.md) y
`git log`.

## Reglas que no se negocian

1. **`fve_app` NUNCA es superusuario.** Un superusuario ignora RLS y el
   aislamiento entre negocios desaparecería sin que nada falle a la vista (hay un
   test que lo verifica). Nueva tabla por-negocio → agrégala a
   `TENANT_SCOPED_TABLES` (`packages/db/src/tenancy.ts`) **y** ponle políticas RLS
   en la migración.
2. Todo monto es `bigint` en unidades menores (nunca `number`/float) y se persiste
   **junto a la tasa** con que se calculó. Un histórico jamás se recalcula con la
   tasa de hoy.
3. Los `.env` (`apps/api/.env`, `packages/db/.env`) están **gitignoreados** y
   llevan credenciales locales desechables. **No commitear.** En un clon nuevo hay
   que recrearlos desde los `.env.example`.
4. Commit/push **solo cuando el usuario lo pida**. Si estás en `main`, ramifica
   primero. Cierra los mensajes de commit con
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Gotcha de operación

La API se arranca con `tsx` (sin watch). **Tras cambiar el core hay que reiniciar
la API** (matar el proceso del puerto 3001 y relanzar) para que tome el código
nuevo. Los tests corren contra `fve_test` (no `fve_dev`), así que `npm test` ya no
borra la demo.

## Diseño

Barra lateral oscura (navy), área de trabajo clara, sobrio y de alto contraste,
responsive; la tasa del BCV se autoactualiza. Tokens OKLCH en
`apps/web/src/index.css`; componentes compartidos en
`apps/web/src/components/ui.tsx` (Boton, Campo, Select, Tarjeta, Aviso, Insignia,
Segmentado, Modal…). Reutilizarlos; no reintroducir modales locales.

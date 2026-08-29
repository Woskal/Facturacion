-- El login necesita saber a qué negocios pertenece una persona ANTES de que
-- exista contexto de negocio — cuál es el negocio es justamente lo que el login
-- viene a averiguar. Pero `memberships` está bajo aislamiento y exige ese
-- contexto ya fijado.
--
-- El intento anterior fue una función `SECURITY DEFINER`, y NO FUNCIONA:
-- `FORCE ROW LEVEL SECURITY` aplica también al dueño de las tablas, así que la
-- función corría como `fve_app` y seguía sujeta a la política. Devolvía cero
-- filas siempre. Hacerla funcionar habría exigido un rol aparte con `BYPASSRLS`,
-- que es un privilegio demasiado grande para dárselo a nadie por esto.
--
-- La salida correcta es declarativa: una segunda política que permite a una
-- persona leer SUS PROPIAS membresías. Queda visible en el catálogo de la base,
-- se audita como cualquier otra política, y no concede nada más — leer que uno
-- pertenece a un negocio es información que uno ya tiene.
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;--> statement-breakpoint

-- Las políticas permisivas se combinan con OR: una fila de `memberships` es
-- legible si pertenece al negocio activo O si es del usuario activo. Escribir
-- sigue exigiendo contexto de negocio: esta política es solo de lectura.
CREATE POLICY memberships_self_read ON memberships
  FOR SELECT
  USING (user_id = app_current_user());--> statement-breakpoint

-- Se retira la función anterior para no dejar rondando un objeto con
-- `SECURITY DEFINER` que no hace lo que su nombre promete.
DROP FUNCTION IF EXISTS app_user_memberships(uuid);

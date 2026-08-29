-- Aislamiento de `station_credentials`, con el mismo patrón que el resto.
ALTER TABLE station_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE station_credentials FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY station_credentials_tenant_isolation ON station_credentials
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- El login necesita saber a qué negocios pertenece un usuario ANTES de que
-- exista contexto de negocio — cuál es el negocio es justamente lo que el login
-- viene a averiguar. Pero `memberships` está bajo aislamiento y exige ese
-- contexto ya fijado.
--
-- Esta función es la salida: un agujero deliberado, estrecho y auditable en un
-- solo sitio. Devuelve únicamente las membresías activas del usuario indicado y
-- nada más. La alternativa —aflojar la política de `memberships`— abriría la
-- tabla entera a cualquier consulta sin contexto, que es mucho peor.
CREATE OR REPLACE FUNCTION app_user_memberships(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, tenant_name text, role member_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT m.tenant_id, t.name, m.role
  FROM memberships m
  JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
    AND m.archived_at IS NULL
    AND t.archived_at IS NULL
  ORDER BY t.name
$$;--> statement-breakpoint

-- Que no quede accesible a roles inesperados si algún día hay más de uno. El
-- dueño de la función conserva EXECUTE, así que no se concede a ningún rol por
-- nombre: hacerlo ataría la migración al rol del entorno de desarrollo.
REVOKE ALL ON FUNCTION app_user_memberships(uuid) FROM PUBLIC;

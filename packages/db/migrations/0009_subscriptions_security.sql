-- Las tablas de suscripción van bajo el mismo aislamiento que el resto, aunque
-- quien las administra sea el operador de la plataforma. Es la misma decisión
-- que en el panel de negocios: el operador lee negocio por negocio dentro de su
-- contexto, en vez de que exista un rol capaz de leerlo todo.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions', 'subscription_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

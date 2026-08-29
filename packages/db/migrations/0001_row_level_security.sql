-- Aislamiento entre negocios, hecho cumplir por Postgres.
--
-- Cada tabla con `tenant_id` queda bajo una política que solo deja ver y tocar
-- las filas del negocio activo, tomado de la variable de sesión `app.tenant_id`
-- que fija `withTenant()` dentro de la transacción.
--
-- Se usa FORCE ROW LEVEL SECURITY para que la política aplique también al dueño
-- de las tablas: sin FORCE, el rol de la aplicación —que es el dueño— la
-- ignoraría por completo y el aislamiento sería decorativo.
--
-- Un superusuario sigue saltándose las políticas. Por eso la aplicación NO debe
-- conectarse nunca con un rol superusuario.

-- Devuelve el negocio activo, o NULL si no se fijó ninguno.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;--> statement-breakpoint

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'memberships',
    'stations',
    'exchange_rates',
    'tax_rates',
    'price_lists',
    'products',
    'product_prices',
    'customers',
    'document_series',
    'number_reservations',
    'documents',
    'document_lines',
    'document_tax_breakdown',
    'document_payments',
    'stock_movements',
    'expense_categories',
    'expenses',
    'receivables',
    'receivable_entries',
    'cash_sessions',
    'cash_counts',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    -- USING filtra lo que se puede leer, actualizar y borrar.
    -- WITH CHECK impide insertar o mover una fila hacia otro negocio.
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;--> statement-breakpoint

-- La bitácora de auditoría es de solo inserción: nadie la edita ni la borra,
-- ni siquiera dentro de su propio negocio. Un registro de auditoría modificable
-- no sirve de nada ante una fiscalización.
DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (tenant_id = app_current_tenant());--> statement-breakpoint

-- Un documento emitido es inmutable.
--
-- La regla vive en la base y no solo en el código de la aplicación porque un
-- documento que se puede editar después de emitido invalida el consecutivo, el
-- libro de ventas y cualquier posibilidad de homologación futura. Se permite
-- únicamente pasar a VOIDED, que anula conservando la fila y el número.
CREATE OR REPLACE FUNCTION documents_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un documento emitido no se borra: se anula (%).', OLD.full_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'ISSUED' AND NEW.status = 'VOIDED' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('ISSUED', 'VOIDED') THEN
    RAISE EXCEPTION 'El documento % ya fue emitido y no admite cambios. Corrija con una nota de crédito.', OLD.full_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER documents_immutable
BEFORE UPDATE OR DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION documents_forbid_mutation();--> statement-breakpoint

-- Las líneas, el desglose de impuestos y los pagos de un documento emitido
-- tampoco se tocan: si fueran mutables, el documento sería mutable por la
-- puerta de atrás.
CREATE OR REPLACE FUNCTION document_children_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status document_status;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(NEW.document_id, OLD.document_id);
  SELECT status INTO parent_status FROM documents WHERE id = parent_id;

  IF parent_status IN ('ISSUED', 'VOIDED') THEN
    RAISE EXCEPTION 'El documento ya fue emitido: su detalle no admite cambios.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint

CREATE TRIGGER document_lines_immutable
BEFORE INSERT OR UPDATE OR DELETE ON document_lines
FOR EACH ROW EXECUTE FUNCTION document_children_forbid_mutation();--> statement-breakpoint

CREATE TRIGGER document_tax_breakdown_immutable
BEFORE INSERT OR UPDATE OR DELETE ON document_tax_breakdown
FOR EACH ROW EXECUTE FUNCTION document_children_forbid_mutation();--> statement-breakpoint

CREATE TRIGGER document_payments_immutable
BEFORE INSERT OR UPDATE OR DELETE ON document_payments
FOR EACH ROW EXECUTE FUNCTION document_children_forbid_mutation();

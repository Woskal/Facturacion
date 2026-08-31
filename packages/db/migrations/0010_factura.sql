-- La factura es el documento que el negocio realmente vende. Faltaba.
--
-- El sistema no la valida ante el SENIAT: la imprime sobre forma libre de una
-- imprenta autorizada, que es de donde sale el número de control. Esa columna ya
-- existía en `documents` desde el principio, esperando este momento.
ALTER TYPE document_kind ADD VALUE IF NOT EXISTS 'FACTURA';--> statement-breakpoint

-- Datos que van impresos en el encabezado del documento. El RIF ya estaba; lo
-- que faltaba es todo lo demás que un cliente espera ver en una factura.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_name text;--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city text;--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email text;--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website text;--> statement-breakpoint
-- Pie libre: condiciones de pago, garantía, lo que cada negocio quiera decir.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS document_footer text;--> statement-breakpoint

-- Número de control de la imprenta autorizada.
--
-- No lo genera el sistema: viene preimpreso en el talonario. Se guarda el rango
-- que el negocio tiene en mano para poder asignarlo en orden y avisar cuando se
-- esté acabando.
ALTER TABLE document_series ADD COLUMN IF NOT EXISTS control_prefix text;--> statement-breakpoint
ALTER TABLE document_series ADD COLUMN IF NOT EXISTS control_next integer;--> statement-breakpoint
ALTER TABLE document_series ADD COLUMN IF NOT EXISTS control_last integer;

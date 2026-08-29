-- El arqueo necesita saber qué ventas pertenecen a qué turno. Deducirlo por
-- ventana de tiempo entre apertura y cierre falla justo en los bordes, que es
-- cuando más importa, así que el vínculo es explícito.
ALTER TABLE "documents" ADD COLUMN "cash_session_id" uuid;--> statement-breakpoint

-- El vuelto sale del efectivo. Sin registrarlo, la caja aparece siempre con un
-- faltante igual a todo lo devuelto en el turno.
ALTER TABLE "documents" ADD COLUMN "change_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "change_currency" "currency";--> statement-breakpoint

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_cash_session_id_cash_sessions_id_fk"
  FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id");--> statement-breakpoint

CREATE INDEX "documents_cash_session_idx" ON "documents" ("cash_session_id");

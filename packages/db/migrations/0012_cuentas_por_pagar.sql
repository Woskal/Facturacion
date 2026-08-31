CREATE TABLE "purchase_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" bigint NOT NULL,
	"amount_usd" bigint NOT NULL,
	"amount_ves" bigint NOT NULL,
	"exchange_rate_id" uuid NOT NULL,
	"rate_bs_per_usd" bigint NOT NULL,
	"method" "payment_method",
	"reference" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_payments_purchase_idx" ON "purchase_payments" USING btree ("purchase_id");--> statement-breakpoint

-- Seguridad por fila para la tabla nueva: cada negocio solo ve sus pagos.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE purchase_payments ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE purchase_payments FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS purchase_payments_tenant_isolation ON purchase_payments';
  EXECUTE 'CREATE POLICY purchase_payments_tenant_isolation ON purchase_payments USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())';
END $$;

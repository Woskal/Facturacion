CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'ISSUE', 'VOID', 'DELETE', 'LOGIN');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('VES', 'USD');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('PRESUPUESTO', 'NOTA_ENTREGA', 'RECIBO', 'NOTA_CREDITO');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('DRAFT', 'ISSUED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."id_kind" AS ENUM('V', 'E', 'J', 'G', 'P');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('OWNER', 'ADMIN', 'CASHIER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('EFECTIVO_BS', 'EFECTIVO_USD', 'PAGO_MOVIL', 'TRANSFERENCIA_BS', 'PUNTO_VENTA', 'ZELLE', 'USDT', 'CREDITO');--> statement-breakpoint
CREATE TYPE "public"."price_mode" AS ENUM('IVA_INCLUIDO', 'IVA_EXCLUIDO');--> statement-breakpoint
CREATE TYPE "public"."rate_source" AS ENUM('BCV', 'MANUAL', 'PARALELO');--> statement-breakpoint
CREATE TYPE "public"."receivable_entry_kind" AS ENUM('PAYMENT', 'RETENTION_IVA', 'RETENTION_ISLR', 'CREDIT_NOTE', 'WRITE_OFF');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('INITIAL', 'SALE', 'PURCHASE', 'RETURN', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'CASHIER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rif_kind" "id_kind" NOT NULL,
	"rif_number" text NOT NULL,
	"trade_name" text,
	"address" text,
	"phone" text,
	"special_taxpayer" boolean DEFAULT false NOT NULL,
	"igtf_bps" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"id_kind" "id_kind" NOT NULL,
	"id_number" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"special_taxpayer" boolean DEFAULT false NOT NULL,
	"credit_limit" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bs_per_usd" bigint NOT NULL,
	"effective_on" date NOT NULL,
	"source" "rate_source" DEFAULT 'BCV' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"unit_price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"unit" text DEFAULT 'UND' NOT NULL,
	"tax_rate_id" uuid NOT NULL,
	"price_mode" "price_mode" DEFAULT 'IVA_INCLUIDO' NOT NULL,
	"tracks_stock" boolean DEFAULT true NOT NULL,
	"min_stock" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"base_bps" integer NOT NULL,
	"adicional_bps" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"product_id" uuid,
	"sku" text,
	"description" text NOT NULL,
	"unit" text DEFAULT 'UND' NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"price_mode" "price_mode" NOT NULL,
	"tax_rate_id" uuid,
	"tax_code" text NOT NULL,
	"tax_base_bps" integer NOT NULL,
	"tax_adicional_bps" integer DEFAULT 0 NOT NULL,
	"gross" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"base" bigint NOT NULL,
	"iva_base" bigint DEFAULT 0 NOT NULL,
	"iva_adicional" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" bigint NOT NULL,
	"amount_usd" bigint NOT NULL,
	"amount_ves" bigint NOT NULL,
	"is_divisa" boolean DEFAULT false NOT NULL,
	"reference" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid,
	"kind" "document_kind" NOT NULL,
	"prefix" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_tax_breakdown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"tax_code" text NOT NULL,
	"base_bps" integer NOT NULL,
	"adicional_bps" integer DEFAULT 0 NOT NULL,
	"base_usd" bigint NOT NULL,
	"base_ves" bigint NOT NULL,
	"iva_base_usd" bigint NOT NULL,
	"iva_base_ves" bigint NOT NULL,
	"iva_adicional_usd" bigint DEFAULT 0 NOT NULL,
	"iva_adicional_ves" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"series_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"full_number" text NOT NULL,
	"control_number" text,
	"station_id" uuid NOT NULL,
	"issued_by_user_id" uuid NOT NULL,
	"customer_id" uuid,
	"related_document_id" uuid,
	"status" "document_status" DEFAULT 'DRAFT' NOT NULL,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"currency" "currency" NOT NULL,
	"exchange_rate_id" uuid NOT NULL,
	"rate_bs_per_usd" bigint NOT NULL,
	"rate_effective_on" date NOT NULL,
	"gross_usd" bigint DEFAULT 0 NOT NULL,
	"gross_ves" bigint DEFAULT 0 NOT NULL,
	"discount_usd" bigint DEFAULT 0 NOT NULL,
	"discount_ves" bigint DEFAULT 0 NOT NULL,
	"taxable_base_usd" bigint DEFAULT 0 NOT NULL,
	"taxable_base_ves" bigint DEFAULT 0 NOT NULL,
	"exempt_base_usd" bigint DEFAULT 0 NOT NULL,
	"exempt_base_ves" bigint DEFAULT 0 NOT NULL,
	"iva_base_usd" bigint DEFAULT 0 NOT NULL,
	"iva_base_ves" bigint DEFAULT 0 NOT NULL,
	"iva_adicional_usd" bigint DEFAULT 0 NOT NULL,
	"iva_adicional_ves" bigint DEFAULT 0 NOT NULL,
	"total_usd" bigint DEFAULT 0 NOT NULL,
	"total_ves" bigint DEFAULT 0 NOT NULL,
	"igtf_usd" bigint DEFAULT 0 NOT NULL,
	"igtf_ves" bigint DEFAULT 0 NOT NULL,
	"grand_total_usd" bigint DEFAULT 0 NOT NULL,
	"grand_total_ves" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"client_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"from_number" integer NOT NULL,
	"to_number" integer NOT NULL,
	"consumed_up_to" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cash_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"currency" "currency" NOT NULL,
	"opening_amount" bigint DEFAULT 0 NOT NULL,
	"expected_amount" bigint DEFAULT 0 NOT NULL,
	"counted_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"opened_by_user_id" uuid NOT NULL,
	"closed_by_user_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"exchange_rate_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid,
	"description" text NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" bigint NOT NULL,
	"amount_usd" bigint NOT NULL,
	"amount_ves" bigint NOT NULL,
	"exchange_rate_id" uuid NOT NULL,
	"rate_bs_per_usd" bigint NOT NULL,
	"paid_with" "payment_method",
	"reference" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"kind" "receivable_entry_kind" NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" bigint NOT NULL,
	"amount_usd" bigint NOT NULL,
	"amount_ves" bigint NOT NULL,
	"exchange_rate_id" uuid NOT NULL,
	"rate_bs_per_usd" bigint NOT NULL,
	"method" "payment_method",
	"reference" text,
	"retention_number" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"original_amount" bigint NOT NULL,
	"due_on" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"quantity" bigint NOT NULL,
	"document_id" uuid,
	"reason" text,
	"created_by_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" "audit_action" NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_payments" ADD CONSTRAINT "document_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_payments" ADD CONSTRAINT "document_payments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tax_breakdown" ADD CONSTRAINT "document_tax_breakdown_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tax_breakdown" ADD CONSTRAINT "document_tax_breakdown_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_series_id_document_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_related_document_id_documents_id_fk" FOREIGN KEY ("related_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_reservations" ADD CONSTRAINT "number_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_reservations" ADD CONSTRAINT "number_reservations_series_id_document_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."document_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_reservations" ADD CONSTRAINT "number_reservations_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_session_id_cash_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_receivable_id_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_unique" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_tenant_code_unique" ON "stations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_rif_unique" ON "tenants" USING btree ("rif_kind","rif_number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_id_unique" ON "customers" USING btree ("tenant_id","id_kind","id_number");--> statement-breakpoint
CREATE INDEX "customers_tenant_name_idx" ON "customers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_tenant_date_unique" ON "exchange_rates" USING btree ("tenant_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_tenant_name_unique" ON "price_lists" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_prices_product_list_unique" ON "product_prices" USING btree ("product_id","price_list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_unique" ON "products" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "products_tenant_barcode_idx" ON "products" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "products_tenant_name_idx" ON "products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rates_tenant_code_unique" ON "tax_rates" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "document_lines_document_line_unique" ON "document_lines" USING btree ("document_id","line_number");--> statement-breakpoint
CREATE INDEX "document_payments_document_idx" ON "document_payments" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_series_unique" ON "document_series" USING btree ("tenant_id","kind","prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "document_tax_breakdown_unique" ON "document_tax_breakdown" USING btree ("document_id","tax_code");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_series_number_unique" ON "documents" USING btree ("series_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_client_ref_unique" ON "documents" USING btree ("tenant_id","client_ref");--> statement-breakpoint
CREATE INDEX "documents_tenant_issued_idx" ON "documents" USING btree ("tenant_id","issued_at");--> statement-breakpoint
CREATE INDEX "documents_tenant_customer_idx" ON "documents" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_status_idx" ON "documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "number_reservations_series_from_unique" ON "number_reservations" USING btree ("series_id","from_number");--> statement-breakpoint
CREATE INDEX "number_reservations_station_idx" ON "number_reservations" USING btree ("station_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_counts_session_method_currency_unique" ON "cash_counts" USING btree ("session_id","method","currency");--> statement-breakpoint
CREATE INDEX "cash_sessions_tenant_station_idx" ON "cash_sessions" USING btree ("tenant_id","station_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_tenant_name_unique" ON "expense_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "expenses_tenant_occurred_idx" ON "expenses" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "receivable_entries_receivable_idx" ON "receivable_entries" USING btree ("receivable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receivables_document_unique" ON "receivables" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "receivables_tenant_customer_idx" ON "receivables" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_product_idx" ON "stock_movements" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_document_idx" ON "stock_movements" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_occurred_idx" ON "audit_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");
CREATE TYPE "public"."billing_period" AS ENUM('MENSUAL', 'SEMESTRAL', 'ANUAL');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" bigint NOT NULL,
	"amount_usd" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"periods" integer DEFAULT 1 NOT NULL,
	"paid_through_after" date NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'TRIAL' NOT NULL,
	"period" "billing_period" DEFAULT 'MENSUAL' NOT NULL,
	"price_usd" bigint NOT NULL,
	"paid_through" date NOT NULL,
	"grace_days" integer DEFAULT 5 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_payments_tenant_idx" ON "subscription_payments" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_unique" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscriptions_paid_through_idx" ON "subscriptions" USING btree ("paid_through");
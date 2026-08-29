-- El producto apunta a negocios pequeños donde una persona hace todo. Los roles
-- ADMIN, CASHIER y VIEWER se retiran: eran maquinaria para un problema que no
-- existe, y una matriz de permisos con roles que nadie usa igual hay que
-- mantenerla y probarla.
--
-- La columna `role` se conserva con un único valor. Es la costura por donde
-- entrarán más roles el día que un negocio tenga varios usuarios: agregar
-- valores a un enum es barato, reintroducir la columna después no lo es.
--
-- Postgres no permite quitar valores de un enum, así que se sustituye el tipo.

-- Cualquier membresía con un rol retirado pasa a ser dueño. En este punto del
-- proyecto no hay datos reales, pero la migración tiene que ser correcta igual:
-- correrá contra la base de alguien alguna vez.
UPDATE memberships SET role = 'OWNER' WHERE role <> 'OWNER';--> statement-breakpoint

ALTER TABLE memberships ALTER COLUMN role DROP DEFAULT;--> statement-breakpoint

CREATE TYPE member_role_new AS ENUM ('OWNER');--> statement-breakpoint

ALTER TABLE memberships
  ALTER COLUMN role TYPE member_role_new
  USING role::text::member_role_new;--> statement-breakpoint

DROP TYPE member_role;--> statement-breakpoint

ALTER TYPE member_role_new RENAME TO member_role;--> statement-breakpoint

ALTER TABLE memberships ALTER COLUMN role SET DEFAULT 'OWNER';

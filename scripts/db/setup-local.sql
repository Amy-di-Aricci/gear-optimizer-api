-- Creates the local development and test databases. Run once, as the
-- postgres superuser (it asks for that password, then for a new one):
--
--   psql -U postgres -h localhost -f scripts/db/setup-local.sql
--
-- Safe to re-run: existing roles and databases are left alone.

\prompt 'Choose a password for the gear_dev role: ' dev_password

-- CREATEDB lets `prisma migrate dev` create its temporary shadow database.
SELECT format('CREATE ROLE gear_dev LOGIN CREATEDB PASSWORD %L', :'dev_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gear_dev') \gexec

SELECT format('CREATE DATABASE %I OWNER gear_dev', name)
FROM (VALUES ('gear_optimizer_dev'), ('gear_optimizer_test')) AS databases(name)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = name) \gexec

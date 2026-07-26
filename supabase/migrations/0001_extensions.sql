-- ============================================================
-- 0001_extensions.sql
-- Propósito: extensiones Postgres necesarias para el esquema de reservas WAYA.
--   - uuid-ossp  → uuid_generate_v4() (PK por defecto de la mayoría de tablas).
--   - pgcrypto   → gen_random_uuid()  (PK de payments e inventory_units).
-- Idempotente (create extension if not exists).
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

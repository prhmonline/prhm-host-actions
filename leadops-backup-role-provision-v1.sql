-- Fixed scope ONLY. Reviewed production DBA/owner approval required before running.
-- This candidate must be executed as the existing leadops_admin role on DB leadops.
-- No table rights are added to leadops_app; no existing ACL is revoked.
-- Local socket is trust-authenticated in the observed production pg_hba.conf.
-- Password NULL prevents network SCRAM authentication with this role.
\set ON_ERROR_STOP on
BEGIN;
DO $create$
BEGIN
  IF current_database() <> 'leadops' OR current_user <> 'leadops_admin' THEN
    RAISE EXCEPTION 'backup_role_wrong_database_or_operator';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='leadops_backup') THEN
    RAISE EXCEPTION 'backup_role_already_exists_requires_separate_reconciliation';
  END IF;
END;
$create$;
CREATE ROLE leadops_backup LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 1 PASSWORD NULL;
ALTER ROLE leadops_backup SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE leadops TO leadops_backup;
GRANT USAGE ON SCHEMA analytics,audit,automation,core,marketplace TO leadops_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics,audit,automation,core,marketplace
  TO leadops_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA analytics,audit,automation,core,marketplace
  TO leadops_backup;
-- Deliberately DO NOT set ALTER DEFAULT PRIVILEGES; newly added tables must
-- trigger the immutable backup preflight and be reviewed/explicitly granted.
DO $verify$
DECLARE
  p record;
  unreadable integer;
  bad_privs integer;
BEGIN
  SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,
         rolbypassrls,rolinherit,rolcanlogin,rolconnlimit
    INTO p FROM pg_roles WHERE rolname='leadops_backup';
  IF NOT FOUND OR p.rolsuper OR p.rolcreatedb OR p.rolcreaterole
     OR p.rolreplication OR p.rolbypassrls OR p.rolinherit
     OR NOT p.rolcanlogin OR p.rolconnlimit <> 1 THEN
    RAISE EXCEPTION 'backup_role_flags_invalid';
  END IF;
  SELECT count(*) INTO unreadable FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog','information_schema')
      AND NOT has_table_privilege('leadops_backup',
            format('%I.%I',schemaname,tablename),'SELECT');
  IF unreadable <> 0 THEN
    RAISE EXCEPTION 'backup_role_incomplete_tables_count=%',unreadable;
  END IF;
  SELECT count(*) INTO bad_privs FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog','information_schema')
      AND (
        has_table_privilege('leadops_backup',format('%I.%I',schemaname,tablename),'INSERT')
        OR has_table_privilege('leadops_backup',format('%I.%I',schemaname,tablename),'UPDATE')
        OR has_table_privilege('leadops_backup',format('%I.%I',schemaname,tablename),'DELETE')
        OR has_table_privilege('leadops_backup',format('%I.%I',schemaname,tablename),'TRUNCATE')
        OR has_table_privilege('leadops_backup',format('%I.%I',schemaname,tablename),'TRIGGER')
      );
  IF bad_privs <> 0 THEN
    RAISE EXCEPTION 'backup_role_has_write_privilege=%',bad_privs;
  END IF;
  IF NOT has_table_privilege('leadops_backup',
         'marketplace.economic_input_facts','SELECT') THEN
    RAISE EXCEPTION 'protected_economic_table_not_readable';
  END IF;
  IF (SELECT count(*) FROM pg_sequences
      WHERE schemaname NOT IN ('pg_catalog','information_schema')
        AND NOT has_sequence_privilege('leadops_backup',
          format('%I.%I',schemaname,sequencename),'SELECT')) <> 0 THEN
    RAISE EXCEPTION 'backup_role_missing_sequence_select';
  END IF;
END;
$verify$;
COMMIT;

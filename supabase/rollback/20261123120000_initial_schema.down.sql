-- Rollback for 20261123120000_initial_schema. Destroys all STIS data: run only with the owner's approval.
drop schema if exists stis cascade;

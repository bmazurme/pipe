import { types } from 'pg';

// Postgres `timestamp` columns (no time zone, OID 1114 — every createdAt/
// updatedAt via BaseEntity) store a UTC-formatted naive string, but node-pg's
// default parser reconstructs it as if it were *local* time. On any host
// whose TZ isn't UTC that silently shifts every timestamp by the host's
// offset on the way out (e.g. a file uploaded seconds ago showing "3 hours
// ago" on a UTC+3 machine). Parse it as UTC explicitly instead.
types.setTypeParser(1114, (value: string) => new Date(`${value}Z`));

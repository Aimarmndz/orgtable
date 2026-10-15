import "server-only";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { prisma } from "@/app/lib/prisma";
import { uploadDir } from "@/app/lib/storage";

// Backup of the WHOLE instance for its administrator (docs/backups.md, "Instance"): every
// table as JSON plus every uploaded file, in one .zip. Restoring replaces everything, so it
// is only allowed into the same schema version (the list of applied migrations must match).
//
// Tables are read from the catalog, not listed by hand, so a new table is never forgotten.
// Inserting follows the foreign keys; the one cycle (User.managedById ↔
// Workspace.personalOwnerId) is broken by inserting a nullable column empty and filling it in
// at the end. Everything happens in one transaction: a failed restore changes nothing.

export const INSTANCE_FORMAT = "orgtable-instance";
const TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (id: string) => {
  if (!TABLE.test(id)) throw new Error(`Unexpected identifier "${id}"`);
  return `"${id}"`;
};

type Db = Pick<typeof prisma, "$queryRawUnsafe" | "$executeRawUnsafe">;

async function tables(db: Db): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations' ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename);
}

async function migrations(db: Db): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return rows.map((r) => r.migration_name);
}

export async function buildInstanceZip(includeFiles: boolean): Promise<Buffer> {
  const data: Record<string, unknown[]> = {};
  for (const t of await tables(prisma)) {
    const [row] = await prisma.$queryRawUnsafe<{ rows: unknown[] | null }[]>(`SELECT json_agg(x) AS rows FROM ${q(t)} x`);
    data[t] = row?.rows ?? [];
  }
  const manifest = {
    format: INSTANCE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    migrations: await migrations(prisma),
    tables: data,
  };
  const entries: Zippable = { "instance.json": [strToU8(JSON.stringify(manifest)), { level: 6 }] };
  if (includeFiles) {
    const dir = uploadDir();
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
      try {
        entries[`uploads/${name}`] = [new Uint8Array(await readFile(path.join(dir, name))), { level: 0 }];
      } catch {
        // Not a regular file (a directory): skipped.
      }
    }
  }
  return Buffer.from(zipSync(entries));
}

type Fk = { table: string; ref: string; columns: string[]; nullable: boolean };

async function foreignKeys(db: Db): Promise<Fk[]> {
  const rows = await db.$queryRawUnsafe<{ tbl: string; ref: string; cols: string[]; nullable: boolean }[]>(`
    SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS ref,
      array_agg(a.attname::text ORDER BY a.attnum) AS cols, bool_and(NOT a.attnotnull) AS nullable
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace
    GROUP BY c.conname, c.conrelid, c.confrelid`);
  return rows.map((r) => ({
    table: r.tbl.replace(/"/g, ""),
    ref: r.ref.replace(/"/g, ""),
    columns: r.cols,
    nullable: r.nullable,
  }));
}

/** Insertion order and the nullable columns to fill in afterwards (to break cycles). */
export function insertionPlan(all: string[], fks: Fk[]): { order: string[]; deferred: Map<string, string[]> } {
  const edges = fks.filter((f) => f.table !== f.ref && all.includes(f.table) && all.includes(f.ref));
  const deferred = new Map<string, string[]>();
  const order: string[] = [];
  const left = new Set(all);
  let active = [...edges];
  while (left.size > 0) {
    const ready = [...left].filter((t) => !active.some((e) => e.table === t && left.has(e.ref)));
    if (ready.length > 0) {
      for (const t of ready.sort()) {
        order.push(t);
        left.delete(t);
      }
      continue;
    }
    const breakable = active.find((e) => left.has(e.table) && left.has(e.ref) && e.nullable);
    if (!breakable) throw new Error("Cannot order the tables: a cycle of required foreign keys");
    deferred.set(breakable.table, [...(deferred.get(breakable.table) ?? []), ...breakable.columns]);
    active = active.filter((e) => e !== breakable);
  }
  return { order, deferred };
}

async function primaryKey(db: Db, table: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ col: string }[]>(
    `SELECT a.attname::text AS col FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    q(table),
  );
  return rows.map((r) => r.col);
}

export class InstanceRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceRestoreError";
  }
}

/** Replaces the whole database (and writes the uploaded files) from an instance backup. */
export async function restoreInstanceZip(zip: Buffer): Promise<{ tables: number; rows: number; files: number }> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(zip));
  } catch {
    throw new InstanceRestoreError("Not a valid .zip file");
  }
  const raw = entries["instance.json"];
  if (!raw) throw new InstanceRestoreError("instance.json is missing");
  const manifest = JSON.parse(strFromU8(raw)) as {
    format: string;
    migrations: string[];
    tables: Record<string, Record<string, unknown>[]>;
  };
  if (manifest.format !== INSTANCE_FORMAT) throw new InstanceRestoreError("This is not an orgtable instance backup");
  const current = await migrations(prisma);
  if (JSON.stringify(current) !== JSON.stringify(manifest.migrations)) {
    throw new InstanceRestoreError("The backup is from another version of orgtable (its migrations differ)");
  }
  let rows = 0;
  const names = await tables(prisma);
  await prisma.$transaction(
    async (tx) => {
      const { order, deferred } = insertionPlan(names, await foreignKeys(tx));
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${names.map(q).join(", ")} RESTART IDENTITY CASCADE`);
      for (const t of order) {
        const data = manifest.tables[t] ?? [];
        if (data.length === 0) continue;
        const later = deferred.get(t) ?? [];
        const first = later.length ? data.map((r) => ({ ...r, ...Object.fromEntries(later.map((c) => [c, null])) })) : data;
        await tx.$executeRawUnsafe(
          `INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(NULL::${q(t)}, $1::json)`,
          JSON.stringify(first),
        );
        rows += data.length;
      }
      for (const [t, cols] of deferred) {
        const data = manifest.tables[t] ?? [];
        if (data.length === 0) continue;
        const pk = await primaryKey(tx, t);
        await tx.$executeRawUnsafe(
          `UPDATE ${q(t)} AS t SET ${cols.map((c) => `${q(c)} = d.${q(c)}`).join(", ")}
           FROM json_populate_recordset(NULL::${q(t)}, $1::json) AS d
           WHERE ${pk.map((c) => `t.${q(c)} = d.${q(c)}`).join(" AND ")}`,
          JSON.stringify(data),
        );
      }
    },
    { timeout: 30 * 60_000, maxWait: 30_000 },
  );
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  let files = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    const m = name.match(/^uploads\/([A-Za-z0-9._-]+)$/);
    if (!m) continue;
    await writeFile(path.join(dir, m[1]), bytes);
    files += 1;
  }
  return { tables: Object.keys(manifest.tables).length, rows, files };
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

// Tests de scripts/backup.sh y scripts/restore.sh con un `docker` falso en el PATH.
// No hace falta Docker: el falso simula pg_dump, psql y el contenedor app según variables
// de entorno FAKE_*, y apunta cada llamada en un log. Cada test copia los scripts a un
// «repo» temporal, porque se sitúan en la raíz del repositorio y leen su .env.

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");

const DUMP_OK = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "CREATE TABLE t (a int);",
  "",
  "--",
  "-- PostgreSQL database dump complete",
  "--",
  "",
  "\\unrestrict abc",
  "",
].join("\n");

// Falso de `docker compose …`. Solo entiende las llamadas que hacen los scripts.
const FAKE_DOCKER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
[ "$1" = compose ] || exit 90
shift
case "$1" in
  ps)
    [ "\${FAKE_APP_RUNNING:-1}" = 1 ] && echo cid123
    exit 0 ;;
  stop|start|up) exit 0 ;;
  exec|run)
    case "$*" in
      *pg_dump*)
        case "\${FAKE_PG_DUMP:-ok}" in
          ok) printf '%s' "$FAKE_DUMP_OK"; exit 0 ;;
          truncated) printf 'CREATE TABLE t (a int);\\n'; exit 0 ;;
          *) echo 'pg_dump: error: connection refused' >&2; exit 1 ;;
        esac ;;
      *psql*)
        cat > "$FAKE_PSQL_STDIN"
        [ "\${FAKE_PSQL:-ok}" = ok ] || { echo 'ERROR: boom' >&2; exit 3; }
        exit 0 ;;
      *tar*)
        case "\${FAKE_UPLOADS:-ok}" in
          ok) printf 'adjunto' | gzip; exit 0 ;;
          missing) exit 3 ;;
          *) echo 'tar: write error' >&2; exit 2 ;;
        esac ;;
    esac ;;
esac
exit 91
`;

let root: string;
let bin: string;
let log: string;
let psqlStdin: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "orgtable-scripts-"));
  mkdirSync(path.join(root, "scripts"));
  for (const name of ["backup.sh", "restore.sh", "update.sh"]) {
    const dest = path.join(root, "scripts", name);
    copyFileSync(path.join(SCRIPTS_DIR, name), dest);
    chmodSync(dest, 0o755);
  }
  writeFileSync(path.join(root, ".env"), "POSTGRES_USER=u\nPOSTGRES_DB=d\n");
  bin = path.join(root, "fakebin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "docker"), FAKE_DOCKER, { mode: 0o755 });
  // update.sh hace `git pull`: el falso solo lo apunta en el mismo log.
  writeFileSync(
    path.join(bin, "git"),
    `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> "$FAKE_LOG"\n`,
    { mode: 0o755 },
  );
  log = path.join(root, "docker.log");
  psqlStdin = path.join(root, "psql-stdin.sql");
  writeFileSync(log, "");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(
  script: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; input?: string } = {},
) {
  // umask 022 explícito: el script debe proteger sus ficheros aunque el entorno no lo haga.
  const res = spawnSync(
    "bash",
    ["-c", 'umask 022; exec "$@"', "_", path.join(root, "scripts", script), ...args],
    {
      cwd: opts.cwd ?? tmpdir(),
      input: opts.input ?? "",
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FAKE_LOG: log,
        FAKE_DUMP_OK: DUMP_OK,
        FAKE_PSQL_STDIN: psqlStdin,
        ...opts.env,
      },
    },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const mode = (p: string) => statSync(p).mode & 0o777;
const dockerCalls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean);

describe("scripts/backup.sh", () => {
  it("falla y no deja ficheros si pg_dump falla", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_PG_DUMP: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓");
    expect(r.stderr).toContain("pg_dump ha fallado");
    expect(readdirSync(dest)).toEqual([]);
  });

  it("rechaza un volcado truncado (sin la marca final de pg_dump)", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_PG_DUMP: "truncated" } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("incompleto");
    expect(readdirSync(dest)).toEqual([]);
  });

  it("funciona lanzado desde otro directorio y deja copias solo legibles por el dueño", () => {
    const r = run("backup.sh", [], { cwd: tmpdir() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ Backup completado");
    const dir = path.join(root, "backups");
    expect(mode(dir)).toBe(0o700);
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^orgtable-db-.*\.sql\.gz$/);
    expect(files[1]).toMatch(/^orgtable-uploads-.*\.tar\.gz$/);
    for (const f of files) expect(mode(path.join(dir, f))).toBe(0o600);
    // El volcado se pide con --clean --if-exists y con el usuario/BD del .env.
    expect(dockerCalls()).toContain(
      "compose exec -T postgres pg_dump --clean --if-exists -U u -d d",
    );
  });

  it("una ruta de destino relativa se resuelve desde el directorio de llamada", () => {
    const cwd = mkdtempSync(path.join(root, "cwd-"));
    const r = run("backup.sh", ["rel"], { cwd });
    expect(r.status).toBe(0);
    expect(readdirSync(path.join(cwd, "rel"))).toHaveLength(2);
  });

  it("falla si la app está en marcha y no se pueden archivar los adjuntos", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_UPLOADS: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓");
    expect(r.stderr).toContain("tar: write error");
    const files = readdirSync(dest);
    // La copia de la BD, ya verificada, se conserva; la de adjuntos no queda a medias.
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.sql\.gz$/);
  });

  it("omite los adjuntos solo si no existe /data/uploads", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_UPLOADS: "missing" } });
    expect(r.status).toBe(0);
    expect(readdirSync(dest)).toHaveLength(1);
  });

  it("con la app parada archiva los adjuntos con un contenedor efímero", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_APP_RUNNING: "0" } });
    expect(r.status).toBe(0);
    expect(dockerCalls().some((c) => c.startsWith("compose run --rm --no-deps"))).toBe(true);
    expect(readdirSync(dest)).toHaveLength(2);
  });
});

describe("scripts/restore.sh", () => {
  function writeDump(name: string, content: Buffer | string) {
    const p = path.join(root, name);
    writeFileSync(p, content);
    return p;
  }

  it("falla sin tocar Docker si el fichero no existe", () => {
    const r = run("restore.sh", [path.join(root, "nope.sql.gz")], { input: "y\n" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓");
    expect(dockerCalls()).toEqual([]);
  });

  it("falla sin tocar Docker si el fichero no es un gzip válido", () => {
    const file = writeDump("bad.sql.gz", "esto no es gzip");
    const r = run("restore.sh", [file], { input: "y\n" });
    expect(r.status).not.toBe(0);
    expect(dockerCalls()).toEqual([]);
  });

  it("falla sin tocar Docker si el volcado está truncado", () => {
    const file = writeDump("trunc.sql.gz", gzipSync("CREATE TABLE t (a int);\n"));
    const r = run("restore.sh", [file], { input: "y\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("incompleto");
    expect(dockerCalls()).toEqual([]);
  });

  it("no anuncia éxito si psql falla y vuelve a arrancar la app", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "y\n", env: { FAKE_PSQL: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓ Restauración completada");
    expect(r.stderr).toContain("se ha deshecho");
    const calls = dockerCalls();
    expect(calls).toContain("compose stop app");
    expect(calls[calls.length - 1]).toBe("compose start app");
  });

  it("hace copia previa, vacía el esquema en la misma transacción y restaura", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "y\n" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ Restauración completada");

    const pre = readdirSync(path.join(root, "backups"));
    expect(pre).toHaveLength(1);
    expect(pre[0]).toMatch(/^pre-restore-/);
    expect(existsSync(path.join(root, "backups", pre[0]))).toBe(true);

    const calls = dockerCalls();
    const psql = calls.find((c) => c.includes("psql"));
    expect(psql).toContain("-v ON_ERROR_STOP=1 --single-transaction");
    // La copia previa (pg_dump) va antes de parar la app y de restaurar.
    const idx = (s: string) => calls.findIndex((c) => c.includes(s));
    expect(idx("pg_dump")).toBeLessThan(idx("stop app"));
    expect(idx("stop app")).toBeLessThan(idx("psql"));
    expect(calls[calls.length - 1]).toBe("compose start app");

    const sql = readFileSync(psqlStdin, "utf8");
    expect(sql.split("\n")[0]).toBe(
      "SET client_min_messages = warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    );
    expect(sql).toContain("CREATE TABLE t (a int);");
  });

  it("no hace nada si no se confirma", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "n\n" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("Cancelado.");
    expect(dockerCalls()).toEqual([]);
  });

  it("aborta sin restaurar si la copia previa falla", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "y\n", env: { FAKE_PG_DUMP: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("No se pudo hacer la copia previa");
    expect(dockerCalls().some((c) => c.includes("psql"))).toBe(false);
    expect(dockerCalls()).not.toContain("compose stop app");
  });
});

describe("scripts/update.sh", () => {
  it("hace la copia de seguridad antes de traer cambios y reconstruir", () => {
    const r = run("update.sh", []);
    expect(r.status).toBe(0);
    const calls = dockerCalls();
    const idx = (s: string) => calls.findIndex((c) => c.includes(s));
    expect(idx("up -d --wait postgres")).toBe(0);
    expect(idx("pg_dump")).toBeGreaterThan(0);
    expect(idx("pg_dump")).toBeLessThan(idx("git pull --ff-only"));
    expect(idx("git pull --ff-only")).toBeLessThan(idx("up -d --build"));
    expect(readdirSync(path.join(root, "backups"))).toHaveLength(2);
  });

  it("no actualiza si la copia de seguridad falla", () => {
    const r = run("update.sh", [], { env: { FAKE_PG_DUMP: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓ orgtable actualizado");
    const calls = dockerCalls();
    expect(calls.some((c) => c.startsWith("git "))).toBe(false);
    expect(calls.some((c) => c.includes("--build"))).toBe(false);
  });
});

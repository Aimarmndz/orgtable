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

// Tests of scripts/backup.sh and scripts/restore.sh with a fake `docker` in the PATH.
// Docker is not needed: the fake simulates pg_dump, psql and the app container according
// to FAKE_* environment variables, and writes every call to a log. Each test copies the
// scripts to a temporary "repo", because they locate the repository root and read its .env.

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const INSTALL_SH = path.resolve(__dirname, "../install.sh");

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

// Fake `docker compose …`. It only understands the calls the scripts make.
const FAKE_DOCKER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
[ "$1" = compose ] || exit 90
shift
case "$1" in
  ps)
    [ "\${FAKE_APP_RUNNING:-1}" = 1 ] && echo cid123
    exit 0 ;;
  stop|start|up|version|build) exit 0 ;;
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
          ok) printf 'attachment' | gzip; exit 0 ;;
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
  // update.sh runs `git pull`: the fake only records it in the same log.
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
  // Explicit umask 022: the script must protect its files even if the environment does not.
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
  it("fails and leaves no files if pg_dump fails", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_PG_DUMP: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓");
    expect(r.stderr).toContain("pg_dump failed");
    expect(readdirSync(dest)).toEqual([]);
  });

  it("rejects a truncated dump (without pg_dump's end marker)", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_PG_DUMP: "truncated" } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("incomplete");
    expect(readdirSync(dest)).toEqual([]);
  });

  it("works when launched from another directory and leaves backups readable only by the owner", () => {
    const r = run("backup.sh", [], { cwd: tmpdir() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ Backup completed");
    const dir = path.join(root, "backups");
    expect(mode(dir)).toBe(0o700);
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^orgtable-db-.*\.sql\.gz$/);
    expect(files[1]).toMatch(/^orgtable-uploads-.*\.tar\.gz$/);
    for (const f of files) expect(mode(path.join(dir, f))).toBe(0o600);
    // The dump is requested with --clean --if-exists and with the user/DB from .env.
    expect(dockerCalls()).toContain(
      "compose exec -T postgres pg_dump --clean --if-exists -U u -d d",
    );
  });

  it("a relative destination path is resolved from the calling directory", () => {
    const cwd = mkdtempSync(path.join(root, "cwd-"));
    const r = run("backup.sh", ["rel"], { cwd });
    expect(r.status).toBe(0);
    expect(readdirSync(path.join(cwd, "rel"))).toHaveLength(2);
  });

  it("fails if the app is running and the attachments cannot be archived", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_UPLOADS: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓");
    expect(r.stderr).toContain("tar: write error");
    const files = readdirSync(dest);
    // The DB backup, already verified, is kept; the attachments one is not left half-written.
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.sql\.gz$/);
  });

  it("skips the attachments only if /data/uploads does not exist", () => {
    const dest = path.join(root, "out");
    const r = run("backup.sh", [dest], { env: { FAKE_UPLOADS: "missing" } });
    expect(r.status).toBe(0);
    expect(readdirSync(dest)).toHaveLength(1);
  });

  it("with the app stopped it archives the attachments with a throwaway container", () => {
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

  it("fails without touching Docker if the file does not exist", () => {
    const r = run("restore.sh", [path.join(root, "nope.sql.gz")], { input: "y\n" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓");
    expect(dockerCalls()).toEqual([]);
  });

  it("fails without touching Docker if the file is not a valid gzip", () => {
    const file = writeDump("bad.sql.gz", "this is not gzip");
    const r = run("restore.sh", [file], { input: "y\n" });
    expect(r.status).not.toBe(0);
    expect(dockerCalls()).toEqual([]);
  });

  it("fails without touching Docker if the dump is truncated", () => {
    const file = writeDump("trunc.sql.gz", gzipSync("CREATE TABLE t (a int);\n"));
    const r = run("restore.sh", [file], { input: "y\n" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("incomplete");
    expect(dockerCalls()).toEqual([]);
  });

  it("does not announce success if psql fails, and starts the app again", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "y\n", env: { FAKE_PSQL: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓ Restore completed");
    expect(r.stderr).toContain("rolled back");
    const calls = dockerCalls();
    expect(calls).toContain("compose stop app");
    expect(calls[calls.length - 1]).toBe("compose start app");
  });

  it("takes a safety backup, empties the schema in the same transaction and restores", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "y\n" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("✓ Restore completed");

    const pre = readdirSync(path.join(root, "backups"));
    expect(pre).toHaveLength(1);
    expect(pre[0]).toMatch(/^pre-restore-/);
    expect(existsSync(path.join(root, "backups", pre[0]))).toBe(true);

    const calls = dockerCalls();
    const psql = calls.find((c) => c.includes("psql"));
    expect(psql).toContain("-v ON_ERROR_STOP=1 --single-transaction");
    // The safety backup (pg_dump) comes before stopping the app and restoring.
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

  it("does nothing if not confirmed", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "n\n" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("Cancelled.");
    expect(dockerCalls()).toEqual([]);
  });

  it("aborts without restoring if the safety backup fails", () => {
    const file = writeDump("ok.sql.gz", gzipSync(DUMP_OK));
    const r = run("restore.sh", [file], { input: "y\n", env: { FAKE_PG_DUMP: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Could not take the safety backup");
    expect(dockerCalls().some((c) => c.includes("psql"))).toBe(false);
    expect(dockerCalls()).not.toContain("compose stop app");
  });
});

describe("scripts/update.sh", () => {
  it("takes the backup before pulling changes and rebuilding", () => {
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

  it("does not update if the backup fails", () => {
    const r = run("update.sh", [], { env: { FAKE_PG_DUMP: "fail" } });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain("✓ orgtable updated");
    const calls = dockerCalls();
    expect(calls.some((c) => c.startsWith("git "))).toBe(false);
    expect(calls.some((c) => c.includes("--build"))).toBe(false);
  });
});

describe("install.sh", () => {
  // Existing installation in `root` (there is a .git and a .env with CRON_SECRET): so it
  // neither clones nor generates secrets, and `git pull` and `docker compose` go to the
  // fakes in the PATH.
  function runInstall(envFile: string) {
    mkdirSync(path.join(root, ".git"));
    writeFileSync(path.join(root, ".env"), envFile);
    writeFileSync(path.join(bin, "hostname"), "#!/usr/bin/env bash\necho 203.0.113.7\n", {
      mode: 0o755,
    });
    const res = spawnSync("bash", [INSTALL_SH], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FAKE_LOG: log,
        ORGTABLE_DIR: root,
      },
    });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  }

  it("with the port published on every interface it points to the server's IP", () => {
    const r = runInstall("CRON_SECRET=x\nAPP_PORT=3000\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("http://203.0.113.7:3000");
  });

  it("with APP_PORT=127.0.0.1:… it does not point to a URL unreachable through the server's IP", () => {
    const r = runInstall("CRON_SECRET=x\nAPP_PORT=127.0.0.1:3000\n");
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("203.0.113.7");
    expect(r.stdout).toContain("ssh -L 3000:127.0.0.1:3000");
    expect(r.stdout).toContain("http://localhost:3000");
  });

  it("with a specific IP in APP_PORT it points to that IP", () => {
    const r = runInstall("CRON_SECRET=x\nAPP_PORT=10.0.0.5:8080\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("http://10.0.0.5:8080");
  });

  it("without APP_PORT in .env it finishes fine and uses 3000", () => {
    const r = runInstall("CRON_SECRET=x\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("http://203.0.113.7:3000");
  });
});

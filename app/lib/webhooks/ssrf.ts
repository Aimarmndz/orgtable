import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";

// Server-side request forgery guard for webhooks (docs/webhooks.md, "Security"). A webhook
// URL is typed by a user, so orgtable must never be made to call its own network: loopback,
// private ranges, link-local (cloud metadata at 169.254.169.254), carrier-grade NAT, multicast
// and the like are refused.
//
// The check runs inside the socket's DNS lookup (safeLookup), i.e. on the address actually
// connected to, so a name that resolves to a public IP when validated and to 127.0.0.1 when
// used (DNS rebinding) is still refused.
//
// ORGTABLE_WEBHOOKS_ALLOW_PRIVATE=1 lifts it, for self-hosters whose targets are on their own
// network (and for the tests).

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function v6Blocked(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a === "::" || a === "::1") return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms: judge the IPv4 inside.
  const mapped = a.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]);
  if (/^::ffff:/.test(a)) return true;
  const first = parseInt(a.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (a.startsWith("64:ff9b:") || a.startsWith("2001:db8:") || a.startsWith("100:")) return true;
  return false;
}

/** Whether an IP literal is a public address orgtable may call. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !v4Blocked(ip);
  if (kind === 6) return !v6Blocked(ip);
  return false;
}

export function privateTargetsAllowed(): boolean {
  return process.env.ORGTABLE_WEBHOOKS_ALLOW_PRIVATE === "1";
}

export class BlockedAddressError extends Error {
  constructor(public address: string) {
    super(`Refusing to connect to a non-public address (${address})`);
    this.name = "BlockedAddressError";
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A drop-in for dns.lookup that refuses non-public addresses (see the top of the file). */
export function safeLookup(hostname: string, options: object, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    if (!privateTargetsAllowed()) {
      const bad = list.find((a) => !isPublicAddress(a.address));
      if (bad || list.length === 0) return callback(new BlockedAddressError(bad?.address ?? hostname), "");
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

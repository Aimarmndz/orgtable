import { isIP } from "node:net";

// Client IP for the sign-in rate limit and the audit log. No next/headers so it can be
// unit-tested; clientIp() in app/lib/audit.ts uses it. See
// docs/decisions/0009-in-memory-rate-limit.md.
//
// The client controls X-Forwarded-For: each proxy APPENDS the IP it sees, but whatever
// came before was written by the requester. Also, Next only fills the header when it is
// absent (`??=`), so with the app exposed without a proxy the client decides the whole
// header. Hence it is only trusted when the trusted proxies in front are declared
// (TRUSTED_PROXY_HOPS), taking the value set by the outermost of them, counting from the
// right.

/**
 * Number of trusted proxies in front of the app. Empty or unset = 0 (X-Forwarded-For is
 * not used). A value that is not an integer >= 0 is a configuration error.
 */
export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `TRUSTED_PROXY_HOPS must be an integer >= 0 (got: "${value.slice(0, 20)}").`,
    );
  }
  return Number(value);
}

/** Why no IP was obtained even though trusted proxies are declared. */
export type ClientIpProblem = "missing-header" | "too-few-values" | "not-an-ip";

export type ClientIpResult =
  | { ip: string; problem: null }
  | { ip: null; problem: ClientIpProblem | null };

/**
 * Client IP from X-Forwarded-For and the number of trusted proxies (`hops`). With
 * hops = N it takes the N-th value from the right: the one appended by the outermost
 * trusted proxy. No IP when hops is 0 (not a problem: it is the default), when the header
 * is missing, when it has fewer than N values (the request did not go through every
 * proxy) or when the value is not an IP. Pure function.
 */
export function resolveClientIp(xff: string | null, hops: number): ClientIpResult {
  if (hops <= 0) return { ip: null, problem: null };
  if (!xff) return { ip: null, problem: "missing-header" };
  const parts = xff.split(",").map((part) => part.trim());
  if (parts.length < hops) return { ip: null, problem: "too-few-values" };
  const ip = normalizeIp(parts[parts.length - hops]);
  return ip ? { ip, problem: null } : { ip: null, problem: "not-an-ip" };
}

/**
 * Some proxies (Azure Application Gateway, IIS ARR) write the IP with the source port:
 * `1.2.3.4:5678` or `[2001:db8::1]:443`. Without stripping it, isIP rejects it and sign-in
 * loses its per-IP limit; using it as is would give a different key per connection. It
 * is not blindly cut at the last `:`, which would split an IPv6 without brackets.
 */
function normalizeIp(value: string): string | null {
  if (isIP(value)) return value;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) return isIP(bracketed[1]) === 6 ? bracketed[1] : null;
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  if (v4WithPort) return isIP(v4WithPort[1]) === 4 ? v4WithPort[1] : null;
  return null;
}

const PROBLEM_DETAIL: Record<ClientIpProblem, string> = {
  "missing-header": "the request has no X-Forwarded-For",
  "too-few-values": "X-Forwarded-For has fewer values than declared proxies",
  "not-an-ip": "the matching X-Forwarded-For value is not an IP",
};

// One warning per reason and process: enough for the operator to see it in the log
// without repeating it on every sign-in.
const warnedProblems = new Set<ClientIpProblem>();

/**
 * Like resolveClientIp, but warns in the log (once per reason and process) when proxies
 * are declared and no IP is obtained: sign-in loses its per-IP limit and the audit log its
 * IP, and without the warning the operator would believe both are active. The warning
 * includes neither the header nor any IP (they are personal data).
 */
export function pickClientIp(xff: string | null, hops: number): string | null {
  const { ip, problem } = resolveClientIp(xff, hops);
  if (problem && !warnedProblems.has(problem)) {
    warnedProblems.add(problem);
    const values = xff ? xff.split(",").length : 0;
    console.warn(
      `[client-ip] TRUSTED_PROXY_HOPS=${hops} but ${PROBLEM_DETAIL[problem]} ` +
        `(${values} values): sign-in has no per-IP limit and the audit log does not store ` +
        `the IP. Check the proxy configuration. Warned only once per reason and process.`,
    );
  }
  return ip;
}

import { CANDLE_FHIR_URL } from "./helpers";

const WAIT_SECONDS = Number(process.env.E2E_WAIT_TIMEOUT ?? 15);
const POLL_MS = 3000;

interface ServiceCheck {
  name: string;
  url: string;
  optional?: boolean;
}

const checks: ServiceCheck[] = [
  {
    name: "frontend",
    url: process.env.BASE_URL ?? "http://localhost:3000",
  },
  {
    name: "provider server",
    url: `${process.env.PROVIDER_URL ?? "http://localhost:8080"}/fhir/metadata`,
  },
  {
    name: "payer server",
    url: `${process.env.PAYER_URL ?? "http://localhost:8081"}/fhir/metadata`,
  },
  {
    name: "FAST Security RI",
    url: `${process.env.FAST_RI_URL ?? "https://localhost:5001"}/.well-known/udap`,
  },
  {
    name: "fhir-candle",
    url: `${CANDLE_FHIR_URL}/metadata`,
    optional: !process.env.E2E_REQUIRE_CANDLE,
  },
];

const CERT_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

// Any HTTP response means the service is up. Only network errors count as
// down. A TLS certificate error (the FAST RI dev cert is self-signed) still
// proves the service is listening, so it counts as up without weakening TLS
// verification anywhere.
async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    return code !== undefined && CERT_ERROR_CODES.has(code);
  }
}

// The provider registers itself with the FAST RI at startup. Until that
// completes, /auth/login bounces back to /login?error=... and sign-in fails.
// A poll here also triggers the provider's registration retry, so waiting on
// this endpoint actively drives the stack to readiness.
async function waitForAuthReady(deadline: number): Promise<void> {
  const providerUrl = process.env.PROVIDER_URL ?? "http://localhost:8080";
  while (true) {
    try {
      const res = await fetch(`${providerUrl}/auth/login`, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      const location = res.headers.get("location") ?? "";
      if (res.status === 302 && !location.includes("error=")) return;
    } catch {}
    if (Date.now() >= deadline) {
      throw new Error(
        "Provider auth is not ready: /auth/login still fails (UDAP registration with the FAST RI has not completed).",
      );
    }
    console.log("Waiting for provider auth (UDAP registration)...");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export default async function globalSetup() {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let pending = [...checks];

  while (true) {
    const results = await Promise.all(pending.map((c) => isUp(c.url)));
    pending = pending.filter((_, i) => !results[i]);
    if (pending.length === 0) {
      await waitForAuthReady(deadline);
      return;
    }
    if (Date.now() >= deadline) break;
    console.log(
      `Waiting for: ${pending.map((c) => c.name).join(", ")} (${Math.round((deadline - Date.now()) / 1000)}s left)`,
    );
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const required = pending.filter((c) => !c.optional);
  for (const c of pending.filter((s) => s.optional)) {
    console.warn(
      `Optional service ${c.name} (${c.url}) is not reachable. Dependent tests will skip.`,
    );
  }
  if (required.length > 0) {
    const list = required.map((c) => `  - ${c.name}: ${c.url}`).join("\n");
    throw new Error(
      `Required services are not reachable after ${WAIT_SECONDS}s:\n${list}\nStart the dev stack (see playwright.config.ts) or run "bun e2e:stack".`,
    );
  }
}

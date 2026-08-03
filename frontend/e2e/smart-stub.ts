import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

/**
 * Minimal in-process SMART on FHIR server for the SMART login E2E test.
 * Serves discovery, an authorize endpoint that redirects straight back
 * with a code, a token endpoint that verifies PKCE S256, and a FHIR API
 * that requires the issued Bearer token.
 *
 * The BFF and the browser can reach the stub under different hostnames
 * (in stack mode the provider runs in Docker and reaches the host via
 * host.docker.internal). The discovery document therefore points the
 * authorization endpoint at localhost for the browser while the token
 * endpoint reuses whatever host the BFF fetched discovery through.
 */

export interface SmartStub {
  /** FHIR base URL to enter in the settings dialog (BFF-reachable). */
  fhirBaseUrl: string;
  port: number;
  close: () => Promise<void>;
}

export const STUB_FHIR_USER = "Practitioner/e2e-practitioner";
const ID_TOKEN_SECRET = "e2e-stub-secret";

function base64url(data: Buffer): string {
  return data.toString("base64url");
}

function buildIdToken(): string {
  const header = base64url(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        sub: "e2e-practitioner",
        fhirUser: STUB_FHIR_USER,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ),
  );
  const signature = base64url(
    createHmac("sha256", ID_TOKEN_SECRET)
      .update(`${header}.${payload}`)
      .digest(),
  );
  return `${header}.${payload}.${signature}`;
}

const CAPABILITY_STATEMENT = {
  resourceType: "CapabilityStatement",
  status: "active",
  fhirVersion: "4.0.1",
  format: ["json"],
};

const PATIENT_BUNDLE = {
  resourceType: "Bundle",
  type: "searchset",
  total: 1,
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: "e2e-stub-patient",
        name: [{ family: "Stub", given: ["Sam"] }],
        gender: "male",
        birthDate: "1980-01-01",
      },
    },
  ],
};

const EMPTY_BUNDLE = { resourceType: "Bundle", type: "searchset", total: 0 };

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

export function startSmartStub(bffHost: string): Promise<SmartStub> {
  const pendingCodes = new Map<string, string>();
  let accessToken: string | undefined;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    const sendJson = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (path === "/fhir/metadata") {
      return sendJson(200, CAPABILITY_STATEMENT);
    }

    if (path === "/fhir/.well-known/smart-configuration") {
      const port = (server.address() as { port: number }).port;
      return sendJson(200, {
        authorization_endpoint: `http://localhost:${port}/authorize`,
        token_endpoint: `http://${req.headers.host}/token`,
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
        capabilities: ["launch-standalone", "client-public"],
      });
    }

    if (path === "/authorize") {
      const params = url.searchParams;
      if (
        params.get("response_type") !== "code" ||
        params.get("code_challenge_method") !== "S256" ||
        !params.get("code_challenge") ||
        !params.get("redirect_uri")
      ) {
        return sendJson(400, { error: "invalid_request" });
      }
      const code = randomUUID();
      pendingCodes.set(code, params.get("code_challenge") ?? "");
      const redirect = new URL(params.get("redirect_uri") ?? "");
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", params.get("state") ?? "");
      res.writeHead(302, { Location: redirect.toString() });
      return res.end();
    }

    if (path === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const challenge = pendingCodes.get(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const hashed = base64url(createHash("sha256").update(verifier).digest());
      if (
        form.get("grant_type") !== "authorization_code" ||
        !challenge ||
        hashed !== challenge
      ) {
        return sendJson(400, { error: "invalid_grant" });
      }
      pendingCodes.delete(form.get("code") ?? "");
      accessToken = randomUUID();
      return sendJson(200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        scope: form.get("scope") ?? "openid fhirUser user/*.rs",
        id_token: buildIdToken(),
      });
    }

    if (path.startsWith("/fhir/")) {
      if (
        !accessToken ||
        req.headers.authorization !== `Bearer ${accessToken}`
      ) {
        return sendJson(401, { error: "invalid_token" });
      }
      return sendJson(
        200,
        path.includes("/Patient") ? PATIENT_BUNDLE : EMPTY_BUNDLE,
      );
    }

    sendJson(404, { error: "not_found" });
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        fhirBaseUrl: `http://${bffHost}:${port}/fhir`,
        port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

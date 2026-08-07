import type { SmartLaunchContext } from "@/lib/dtr-launch";
import {
  type CustomAuthTarget,
  getServerByUrl,
  getStoredCustomAuthTarget,
  getStoredServerUrl,
} from "@/lib/fhir-config";

const USERINFO_KEY = "spa_userinfo";

interface CallbackResult {
  smartContext?: SmartLaunchContext;
  serverUrl?: string;
}

const callbackRequests = new Map<string, Promise<CallbackResult>>();

export function clearAuthStorage(): void {
  sessionStorage.removeItem(USERINFO_KEY);
}

interface SmartLoginOption {
  clientId?: string;
}

// Returns the stored custom auth target when it governs sign-in for the
// selected server. A preset server can be SMART-secured too, so a stored
// SMART target for the selected server wins over the primary FAST flow.
// A non-SMART record only applies to a genuinely custom server: when the
// same URL is also a configured preset, the preset stays on the primary
// FAST flow.
export function getApplicableCustomAuthTarget(
  selectedServerUrl: string,
): CustomAuthTarget | null {
  const stored = getStoredCustomAuthTarget();
  if (stored?.serverUrl !== selectedServerUrl) {
    return null;
  }
  if (stored.authMode !== "smart" && getServerByUrl(selectedServerUrl)) {
    return null;
  }
  return stored;
}

// Redirects to the server which initiates the OAuth2 flow.
// Without serverUrl, uses the primary FAST RI flow (Tiered OAuth).
// With serverUrl, targets a custom server's issuer (requires prior discovery).
function resolveLoginTarget(
  serverUrl?: string,
  idp?: string,
): {
  serverUrl?: string;
  idp?: string;
  smart?: SmartLoginOption;
} {
  if (serverUrl) {
    return { serverUrl, idp };
  }

  const target = getApplicableCustomAuthTarget(getStoredServerUrl());
  if (!target) {
    return {};
  }
  if (target.authMode === "smart") {
    return {
      serverUrl: target.serverUrl,
      smart: { clientId: target.clientId },
    };
  }
  return target;
}

export function buildLoginPath(
  serverUrl?: string,
  idp?: string,
  smart?: SmartLoginOption,
): string {
  const target = resolveLoginTarget(serverUrl, idp);
  const effectiveSmart = smart ?? target.smart;
  const params = new URLSearchParams();
  if (target.serverUrl) params.set("server", target.serverUrl);
  if (target.idp) params.set("idp", target.idp);
  if (effectiveSmart) {
    params.set("mode", "smart");
    if (effectiveSmart.clientId)
      params.set("clientId", effectiveSmart.clientId);
  }
  const query = params.toString();
  return query ? `/auth/login?${query}` : "/auth/login";
}

export function startLogin(
  serverUrl?: string,
  idp?: string,
  smart?: SmartLoginOption,
): void {
  window.location.href = buildLoginPath(serverUrl, idp, smart);
}

// Called by the callback route after receiving the authorization code
export async function handleCallback(
  code: string,
  state: string,
): Promise<CallbackResult> {
  const requestKey = `${code}:${state}`;
  const existingRequest = callbackRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    const response = await fetch("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
      credentials: "include",
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error_description || "Token exchange failed");
    }
    const { authenticated, userinfo, smartContext, serverUrl } =
      await response.json();
    if (authenticated && userinfo) {
      sessionStorage.setItem(USERINFO_KEY, JSON.stringify(userinfo));
    }
    return { smartContext, serverUrl };
  })();

  callbackRequests.set(requestKey, request);
  try {
    return await request;
  } catch (error) {
    callbackRequests.delete(requestKey);
    throw error;
  }
}

export async function checkSession(): Promise<{
  authenticated: boolean;
  userinfo?: { name?: string; fhirUser?: string; fhirUserType?: string };
  serverUrl?: string;
  expiresAt?: string;
}> {
  const response = await fetch("/auth/session", { credentials: "include" });
  const data = await response.json();
  if (!data.authenticated) {
    clearAuthStorage();
  } else if (data.userinfo) {
    sessionStorage.setItem(USERINFO_KEY, JSON.stringify(data.userinfo));
  }
  return data;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(
    () => {},
  );
  clearAuthStorage();
}

// Writes a locally-selected identity for an open server (requiresAuth: false).
// Uses the same storage slot as a real OAuth login, so downstream consumers
// (usePractitionerRef, Task authorship, display name) work unchanged. This is
// a display/authorship claim only; the open server enforces nothing.
export function setLocalIdentity(identity: {
  name?: string;
  fhirUser: string;
  fhirUserType: string;
}): void {
  sessionStorage.setItem(USERINFO_KEY, JSON.stringify(identity));
}

// Returns user identity from the server-provided userinfo (set during token exchange)
export function getUserInfo(): {
  name?: string;
  fhirUser?: string;
  fhirUserType?: string;
} | null {
  const stored = sessionStorage.getItem(USERINFO_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function isAuthenticated(): boolean {
  return getUserInfo() !== null;
}

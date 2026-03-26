import {
  getServerByUrl,
  getStoredCustomAuthTarget,
  getStoredServerUrl,
} from "@/lib/fhir-config";

const USERINFO_KEY = "spa_userinfo";
const SESSION_SERVER_KEY = "spa_session_server";
const callbackRequests = new Map<string, Promise<void>>();

export function clearAuthStorage(): void {
  sessionStorage.removeItem(USERINFO_KEY);
  sessionStorage.removeItem(SESSION_SERVER_KEY);
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
} {
  if (serverUrl) {
    return { serverUrl, idp };
  }

  const selectedServerUrl = getStoredServerUrl();
  if (getServerByUrl(selectedServerUrl)) {
    return {};
  }

  const storedCustomAuthTarget = getStoredCustomAuthTarget();
  if (storedCustomAuthTarget?.serverUrl !== selectedServerUrl) {
    return {};
  }

  return storedCustomAuthTarget;
}

export function buildLoginPath(serverUrl?: string, idp?: string): string {
  const target = resolveLoginTarget(serverUrl, idp);
  const params = new URLSearchParams();
  if (target.serverUrl) params.set("server", target.serverUrl);
  if (target.idp) params.set("idp", target.idp);
  const query = params.toString();
  return query ? `/auth/login?${query}` : "/auth/login";
}

export function startLogin(serverUrl?: string, idp?: string): void {
  window.location.href = buildLoginPath(serverUrl, idp);
}

// Called by the callback route after receiving the authorization code
export async function handleCallback(
  code: string,
  state: string,
): Promise<void> {
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
    const { authenticated, userinfo, serverUrl } = await response.json();
    if (authenticated) {
      if (userinfo) {
        sessionStorage.setItem(USERINFO_KEY, JSON.stringify(userinfo));
      }
      if (serverUrl) {
        sessionStorage.setItem(SESSION_SERVER_KEY, serverUrl);
      }
    }
  })();

  callbackRequests.set(requestKey, request);
  try {
    await request;
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
  } else {
    if (data.userinfo) {
      sessionStorage.setItem(USERINFO_KEY, JSON.stringify(data.userinfo));
    }
    if (data.serverUrl) {
      sessionStorage.setItem(SESSION_SERVER_KEY, data.serverUrl);
    } else {
      sessionStorage.removeItem(SESSION_SERVER_KEY);
    }
  }
  return data;
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(
    () => {},
  );
  clearAuthStorage();
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

/**
 * Returns the authenticated server URL for the current session, or null.
 */
export function getSessionServerUrl(): string | null {
  return sessionStorage.getItem(SESSION_SERVER_KEY);
}

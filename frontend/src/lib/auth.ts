const USERINFO_KEY = "spa_userinfo";
const callbackRequests = new Map<string, Promise<void>>();

// Redirects to the server which initiates the OAuth2 flow with the FAST RI
export function startLogin(): void {
  window.location.href = "/auth/login";
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
    const { authenticated, userinfo } = await response.json();
    if (authenticated) {
      sessionStorage.setItem(USERINFO_KEY, JSON.stringify(userinfo || {}));
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
}> {
  const response = await fetch("/auth/session", { credentials: "include" });
  return response.json();
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(
    () => {},
  );
  sessionStorage.removeItem(USERINFO_KEY);
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

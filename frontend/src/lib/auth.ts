const TOKEN_KEY = "spa_access_token";
const ID_TOKEN_KEY = "spa_id_token";
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
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error_description || "Token exchange failed");
    }
    const { access_token, id_token, userinfo } = await response.json();
    sessionStorage.setItem(TOKEN_KEY, access_token);
    if (id_token) sessionStorage.setItem(ID_TOKEN_KEY, id_token);
    if (userinfo) sessionStorage.setItem(USERINFO_KEY, JSON.stringify(userinfo));
  })();

  callbackRequests.set(requestKey, request);
  try {
    await request;
  } catch (error) {
    callbackRequests.delete(requestKey);
    throw error;
  }
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export async function logout(): Promise<void> {
  // Invalidate server-side session so the login form is shown on next sign-in
  await fetch("/auth/logout", { method: "POST" }).catch(() => {});
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ID_TOKEN_KEY);
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
    } catch { /* fall through */ }
  }
  // Fallback: decode ID token payload for display (not for security)
  const token =
    sessionStorage.getItem(ID_TOKEN_KEY) ||
    sessionStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const fhirUser: string | undefined = payload.fhirUser;
    return {
      name: payload.name,
      fhirUser,
      fhirUserType: fhirUser?.split("/")[0],
    };
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { resetActiveServerSync } from "@/hooks/use-fhir-server";
import { resetActivePayerSync } from "@/hooks/use-payer-server";
import {
  checkSession,
  clearAuthStorage,
  getUserInfo,
  logout,
  startLogin,
} from "@/lib/auth";
import {
  getAppConfig,
  getServerByUrl,
  getStoredServerUrl,
  isStoredCustomOpenServer,
} from "@/lib/fhir-config";

export function useAuth() {
  const config = getAppConfig();
  const authEnabled = config.authEnabled !== false;
  // Local identity mode requires an explicit openness signal: either a server
  // configured requiresAuth: false, or a custom server whose save-time probe
  // confirmed an open non-UDAP FHIR server. Openness is never inferred here.
  const storedUrl = getStoredServerUrl();
  const localIdentityMode =
    authEnabled &&
    (getServerByUrl(storedUrl)?.requiresAuth === false ||
      isStoredCustomOpenServer(storedUrl));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [, forceUpdate] = useState(0);
  const wasAuthenticated = useRef(false);

  const userInfo = getUserInfo();

  // Verify server-side session is still valid.
  // The session endpoint refreshes the token server-side if near expiry.
  // We poll more frequently as the token approaches expiration.
  const { data: sessionData, isPending: isSessionPending } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: checkSession,
    staleTime: 60 * 1000,
    refetchInterval: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      if (!expiresAt) return 60_000;
      const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
      if (msUntilExpiry < 120_000) return 15_000;
      return 60_000;
    },
    retry: false,
    enabled: authEnabled && !localIdentityMode,
  });

  // Sync local state with server session. Skipped in local identity mode:
  // stale session data cached before a server switch must not clear the
  // locally selected identity.
  useEffect(() => {
    if (localIdentityMode || !sessionData) return;

    if (sessionData.authenticated) {
      wasAuthenticated.current = true;
    } else if (wasAuthenticated.current) {
      // The BFF session is gone, so its copy of the active server and payer
      // went with it. Re-push both before the next proxied request. Only on
      // the transition out of an authenticated session: a signed-out page
      // has nothing to reset, and repeated polls must not re-trigger pushes.
      wasAuthenticated.current = false;
      resetActiveServerSync();
      resetActivePayerSync();
    }

    if (!sessionData.authenticated && userInfo) {
      // Server session expired -- clear local state
      clearAuthStorage();
      forceUpdate((n) => n + 1);
    } else if (sessionData.authenticated && sessionData.userinfo) {
      // Backfill userinfo from server when local copy is empty (e.g. first login)
      const local = getUserInfo();
      if (!local || (!local.name && sessionData.userinfo.name)) {
        sessionStorage.setItem(
          "spa_userinfo",
          JSON.stringify(sessionData.userinfo),
        );
        forceUpdate((n) => n + 1);
      }
    }
  }, [localIdentityMode, sessionData, userInfo]);

  const effectiveUserInfo =
    userInfo ?? (sessionData?.authenticated ? sessionData.userinfo : undefined);
  const isRestoringSession =
    authEnabled && !localIdentityMode && !userInfo && isSessionPending;

  const login = useCallback(
    (serverUrl?: string, idp?: string, smart?: { clientId?: string }) =>
      startLogin(serverUrl, idp, smart),
    [],
  );
  const logoutAndRefresh = useCallback(async () => {
    await logout();
    queryClient.clear();
    forceUpdate((n) => n + 1);
    navigate({ to: "/" });
  }, [queryClient, navigate]);

  return {
    isAuthenticated: !!effectiveUserInfo || sessionData?.authenticated === true,
    isRestoringSession,
    authEnabled,
    localIdentityMode,
    user: effectiveUserInfo,
    fhirUser: effectiveUserInfo?.fhirUser,
    fhirUserType: effectiveUserInfo?.fhirUserType,
    displayName: effectiveUserInfo?.name,
    login,
    logout: logoutAndRefresh,
  };
}

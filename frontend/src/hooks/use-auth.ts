import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  checkSession,
  clearAuthStorage,
  getUserInfo,
  logout,
  startLogin,
} from "@/lib/auth";
import { getAppConfig } from "@/lib/fhir-config";

export function useAuth() {
  const config = getAppConfig();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [, forceUpdate] = useState(0);

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
    enabled: !!config.authEnabled,
  });

  // Sync local state with server session
  useEffect(() => {
    if (!sessionData) return;

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
  }, [sessionData, userInfo]);

  const effectiveUserInfo =
    userInfo ?? (sessionData?.authenticated ? sessionData.userinfo : undefined);
  const isRestoringSession =
    !!config.authEnabled && !userInfo && isSessionPending;

  const login = useCallback(
    (serverUrl?: string, idp?: string) => startLogin(serverUrl, idp),
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
    authEnabled: !!config.authEnabled,
    user: effectiveUserInfo,
    fhirUser: effectiveUserInfo?.fhirUser,
    fhirUserType: effectiveUserInfo?.fhirUserType,
    displayName: effectiveUserInfo?.name,
    login,
    logout: logoutAndRefresh,
  };
}

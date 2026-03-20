import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { checkSession, getUserInfo, logout, startLogin } from "@/lib/auth";
import { getAppConfig } from "@/lib/fhir-config";

export function useAuth() {
  const config = getAppConfig();
  const queryClient = useQueryClient();
  const [, forceUpdate] = useState(0);

  const userInfo = getUserInfo();

  // Verify server-side session is still valid
  const { data: sessionData } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: checkSession,
    staleTime: 60 * 1000,
    retry: false,
  });

  // Sync local state with server session
  useEffect(() => {
    if (!sessionData) return;

    if (!sessionData.authenticated && userInfo) {
      // Server session expired -- clear local state
      sessionStorage.removeItem("spa_userinfo");
      forceUpdate((n) => n + 1);
    } else if (sessionData.authenticated && sessionData.userinfo) {
      // Backfill userinfo from server when local copy is empty (e.g. first login)
      const local = getUserInfo();
      if (!local?.name && sessionData.userinfo.name) {
        sessionStorage.setItem(
          "spa_userinfo",
          JSON.stringify(sessionData.userinfo),
        );
        forceUpdate((n) => n + 1);
      }
    }
  }, [sessionData, userInfo]);

  const login = useCallback(() => startLogin(), []);
  const logoutAndRefresh = useCallback(async () => {
    await logout();
    queryClient.clear();
    forceUpdate((n) => n + 1);
  }, [queryClient]);

  return {
    isAuthenticated: !!userInfo,
    authEnabled: !!config.authEnabled,
    user: userInfo,
    fhirUser: userInfo?.fhirUser,
    fhirUserType: userInfo?.fhirUserType,
    displayName: userInfo?.name,
    login,
    logout: logoutAndRefresh,
  };
}

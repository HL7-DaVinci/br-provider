import { useCallback, useState } from "react";
import {
  getAccessToken,
  getUserInfo,
  startLogin,
  logout,
} from "@/lib/auth";
import { getAppConfig } from "@/lib/fhir-config";

export function useAuth() {
  const config = getAppConfig();
  const [, forceUpdate] = useState(0);

  const token = getAccessToken();
  const userInfo = getUserInfo();

  const login = useCallback(() => startLogin(), []);
  const logoutAndRefresh = useCallback(async () => {
    await logout();
    forceUpdate((n) => n + 1);
  }, []);

  return {
    isAuthenticated: !!token,
    authEnabled: !!config.authEnabled,
    user: userInfo,
    fhirUser: userInfo?.fhirUser,
    fhirUserType: userInfo?.fhirUserType,
    displayName: userInfo?.name,
    login,
    logout: logoutAndRefresh,
  };
}

export interface SmartLaunchContext {
  patient?: string;
  encounter?: string;
  fhirContext?: string[];
  appContext?: string;
}

// Starts a real SMART EHR-launch flow by exchanging the launch token for an
// authorize URL. The caller redirects the window there.
export async function startExternalDtrLaunch(
  iss: string,
  launch: string,
): Promise<string> {
  const response = await fetch("/auth/smart-ehr-launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ iss, launch }),
    credentials: "include",
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err.error_description || err.error || "SMART EHR launch failed",
    );
  }

  const { authorizeUrl } = await response.json();
  return authorizeUrl;
}

interface DtrSmartLaunchSearch {
  iss: string;
  patientId: string;
  encounterId?: string;
  fhirContext?: string;
  coverageAssertionId?: string;
  questionnaire?: string;
  appContext?: string;
}

function parseAppContext(appContext: string): {
  coverageAssertionId?: string;
  questionnaire?: string;
} {
  try {
    const parsed = JSON.parse(appContext);
    return {
      ...(typeof parsed?.coverageAssertionId === "string"
        ? { coverageAssertionId: parsed.coverageAssertionId }
        : {}),
      ...(typeof parsed?.questionnaire === "string"
        ? { questionnaire: parsed.questionnaire }
        : {}),
    };
  } catch {
    return {};
  }
}

// patientId is always included because /dtr treats an empty patientId
// as "no patient selected". Other values are omitted when absent.
export function dtrSearchFromSmartContext(
  serverUrl: string,
  ctx: SmartLaunchContext,
): DtrSmartLaunchSearch {
  const search: DtrSmartLaunchSearch = {
    iss: serverUrl,
    patientId: ctx.patient ?? "",
  };
  if (ctx.encounter) {
    search.encounterId = ctx.encounter;
  }
  if (ctx.fhirContext?.length) {
    search.fhirContext = ctx.fhirContext.join(",");
  }
  if (ctx.appContext) {
    search.appContext = ctx.appContext;
    Object.assign(search, parseAppContext(ctx.appContext));
  }
  return search;
}

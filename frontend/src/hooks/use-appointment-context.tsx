import type { Appointment, Resource } from "fhir/r4";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useReducer,
} from "react";
import type {
  CdsCard,
  CdsHookResponse,
  CoverageInformation,
} from "@/lib/cds-types";

export type BookingPhase = "form" | "review" | "booked";

export interface AppointmentState {
  patientId: string;
  selectedCoverageRef: string | undefined;
  draftAppointment: Partial<Appointment> | null;
  coverageInfo: CoverageInformation[];
  cdsCards: CdsCard[];
  lastRawResponse: CdsHookResponse | null;
  systemActionResources: Map<string, Resource>;
  isHookLoading: boolean;
  hookError: Error | null;
  bookingPhase: BookingPhase;
}

type AppointmentAction =
  | { type: "SET_DRAFT"; payload: Partial<Appointment> }
  | { type: "SET_COVERAGE_REF"; payload: string | undefined }
  | {
      type: "SET_CDS_RESPONSE";
      payload: {
        coverageInfo: CoverageInformation[];
        cards: CdsCard[];
        hookName: string;
        rawResponse: CdsHookResponse | null;
        systemActionResources: Map<string, Resource>;
      };
    }
  | { type: "SET_HOOK_LOADING"; payload: boolean }
  | { type: "SET_HOOK_ERROR"; payload: Error | null }
  | { type: "SET_PHASE"; payload: BookingPhase }
  | { type: "RESET" };

function createInitialState(patientId: string): AppointmentState {
  return {
    patientId,
    selectedCoverageRef: undefined,
    draftAppointment: null,
    coverageInfo: [],
    cdsCards: [],
    lastRawResponse: null,
    systemActionResources: new Map(),
    isHookLoading: false,
    hookError: null,
    bookingPhase: "form",
  };
}

function appointmentReducer(
  state: AppointmentState,
  action: AppointmentAction,
): AppointmentState {
  switch (action.type) {
    case "SET_DRAFT":
      return { ...state, draftAppointment: action.payload };
    case "SET_COVERAGE_REF":
      return { ...state, selectedCoverageRef: action.payload };
    case "SET_CDS_RESPONSE":
      return {
        ...state,
        coverageInfo: action.payload.coverageInfo,
        cdsCards: action.payload.cards,
        lastRawResponse: action.payload.rawResponse,
        systemActionResources: action.payload.systemActionResources,
        isHookLoading: false,
        hookError: null,
      };
    case "SET_HOOK_LOADING":
      return {
        ...state,
        isHookLoading: action.payload,
        ...(action.payload ? { hookError: null } : {}),
      };
    case "SET_HOOK_ERROR":
      return {
        ...state,
        hookError: action.payload,
        isHookLoading: false,
      };
    case "SET_PHASE":
      return { ...state, bookingPhase: action.payload };
    case "RESET":
      return createInitialState(state.patientId);
    default:
      return state;
  }
}

interface AppointmentContextValue {
  state: AppointmentState;
  dispatch: React.Dispatch<AppointmentAction>;
}

const AppointmentContext = createContext<AppointmentContextValue | null>(null);

export function AppointmentContextProvider({
  patientId,
  children,
}: {
  patientId: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    appointmentReducer,
    patientId,
    createInitialState,
  );

  return (
    <AppointmentContext.Provider value={{ state, dispatch }}>
      {children}
    </AppointmentContext.Provider>
  );
}

export function useAppointmentContext(): AppointmentContextValue {
  const ctx = useContext(AppointmentContext);
  if (!ctx) {
    throw new Error(
      "useAppointmentContext must be used within an AppointmentContextProvider",
    );
  }
  return ctx;
}

/**
 * Convenience hook to reset the appointment flow and start over.
 */
export function useResetAppointment() {
  const { dispatch } = useAppointmentContext();
  return useCallback(() => dispatch({ type: "RESET" }), [dispatch]);
}

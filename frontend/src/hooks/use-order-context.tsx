import type { Encounter, Resource } from "fhir/r4";
import { createContext, type ReactNode, useContext, useReducer } from "react";
import type {
  CdsCard,
  CdsHookResponse,
  CoverageInformation,
} from "@/lib/cds-types";
import type { SelectedOrder } from "@/lib/order-templates";

export type EncounterPhase = "start" | "select" | "sign" | "review" | "summary";

export interface TimelineEvent {
  time: Date;
  message: string;
  type: "info" | "cds" | "action" | "error";
}

interface OrderFormState {
  encounter: Encounter | null;
  patientId: string;
  practitionerId: string;
  selectedOrders: SelectedOrder[];
  savedOrderIds: string[];
  sharedFields: Record<string, unknown>;
  coverageInfo: CoverageInformation[];
  cdsCards: CdsCard[];
  lastHookName: string | null;
  lastRawResponse: CdsHookResponse | null;
  systemActionResources: Map<string, Resource>;
  isHookLoading: boolean;
  hookError: Error | null;
  currentPhase: EncounterPhase;
  timelineEvents: TimelineEvent[];
}

type OrderFormAction =
  | { type: "ADD_ORDER"; payload: SelectedOrder }
  | { type: "REMOVE_ORDER"; payload: string }
  | {
      type: "UPDATE_ORDER_CUSTOMIZATION";
      payload: { templateId: string; fields: Record<string, unknown> };
    }
  | { type: "TOGGLE_ORDER_EXPANDED"; payload: string }
  | { type: "SET_ENCOUNTER"; payload: Encounter }
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
  | { type: "UPDATE_SHARED"; payload: Record<string, unknown> }
  | { type: "SIGN_COMPLETE"; payload: string[] }
  | { type: "ADVANCE_PHASE"; payload: EncounterPhase }
  | { type: "ADD_TIMELINE_EVENT"; payload: Omit<TimelineEvent, "time"> }
  | {
      type: "RESTORE_DRAFTS";
      payload: {
        selectedOrders: SelectedOrder[];
        sharedFields: Record<string, unknown>;
      };
    }
  | {
      type: "SET_ORDER_SERVER_IDS";
      payload: Map<string, string>;
    }
  | { type: "RESET" };

function createInitialState(
  patientId: string,
  practitionerId: string,
): OrderFormState {
  return {
    encounter: null,
    patientId,
    practitionerId,
    selectedOrders: [],
    savedOrderIds: [],
    sharedFields: {},
    coverageInfo: [],
    cdsCards: [],
    lastHookName: null,
    lastRawResponse: null,
    systemActionResources: new Map(),
    isHookLoading: false,
    hookError: null,
    currentPhase: "start",
    timelineEvents: [],
  };
}

function orderFormReducer(
  state: OrderFormState,
  action: OrderFormAction,
): OrderFormState {
  switch (action.type) {
    case "ADD_ORDER": {
      const exists = state.selectedOrders.some(
        (o) => o.templateId === action.payload.templateId,
      );
      if (exists) return state;
      return {
        ...state,
        selectedOrders: [...state.selectedOrders, action.payload],
      };
    }
    case "REMOVE_ORDER":
      return {
        ...state,
        selectedOrders: state.selectedOrders.filter(
          (o) => o.templateId !== action.payload,
        ),
      };
    case "UPDATE_ORDER_CUSTOMIZATION":
      return {
        ...state,
        selectedOrders: state.selectedOrders.map((o) =>
          o.templateId === action.payload.templateId
            ? {
                ...o,
                customizations: {
                  ...o.customizations,
                  ...action.payload.fields,
                },
              }
            : o,
        ),
      };
    case "TOGGLE_ORDER_EXPANDED":
      return {
        ...state,
        selectedOrders: state.selectedOrders.map((o) =>
          o.templateId === action.payload ? { ...o, expanded: !o.expanded } : o,
        ),
      };
    case "UPDATE_SHARED":
      return {
        ...state,
        sharedFields: { ...state.sharedFields, ...action.payload },
      };
    case "SET_ENCOUNTER":
      return { ...state, encounter: action.payload };
    case "SET_CDS_RESPONSE":
      return {
        ...state,
        coverageInfo: action.payload.coverageInfo,
        cdsCards: action.payload.cards,
        lastHookName: action.payload.hookName,
        lastRawResponse: action.payload.rawResponse,
        systemActionResources: action.payload.systemActionResources,
        isHookLoading: false,
        hookError: null,
      };
    case "SET_HOOK_LOADING":
      return { ...state, isHookLoading: action.payload };
    case "SET_HOOK_ERROR":
      return { ...state, hookError: action.payload, isHookLoading: false };
    case "SIGN_COMPLETE":
      return {
        ...state,
        savedOrderIds: action.payload,
      };
    case "ADVANCE_PHASE":
      return { ...state, currentPhase: action.payload };
    case "ADD_TIMELINE_EVENT":
      return {
        ...state,
        timelineEvents: [
          ...state.timelineEvents,
          { ...action.payload, time: new Date() },
        ],
      };
    case "RESTORE_DRAFTS":
      return {
        ...state,
        selectedOrders: action.payload.selectedOrders,
        sharedFields: { ...state.sharedFields, ...action.payload.sharedFields },
      };
    case "SET_ORDER_SERVER_IDS": {
      const idMap = action.payload;
      return {
        ...state,
        selectedOrders: state.selectedOrders.map((o) => {
          const serverId = idMap.get(o.templateId);
          return serverId ? { ...o, serverId } : o;
        }),
      };
    }
    case "RESET":
      return createInitialState(state.patientId, state.practitionerId);
    default:
      return state;
  }
}

interface OrderFormContextValue {
  state: OrderFormState;
  dispatch: React.Dispatch<OrderFormAction>;
}

const OrderFormContext = createContext<OrderFormContextValue | null>(null);

interface OrderFormProviderProps {
  patientId: string;
  practitionerId?: string;
  children: ReactNode;
}

export function OrderFormProvider({
  patientId,
  practitionerId = "",
  children,
}: OrderFormProviderProps) {
  const [state, dispatch] = useReducer(
    orderFormReducer,
    createInitialState(patientId, practitionerId),
  );

  return (
    <OrderFormContext value={{ state, dispatch }}>{children}</OrderFormContext>
  );
}

export function useOrderContext(): OrderFormContextValue {
  const context = useContext(OrderFormContext);
  if (!context) {
    throw new Error("useOrderContext must be used within an OrderFormProvider");
  }
  return context;
}

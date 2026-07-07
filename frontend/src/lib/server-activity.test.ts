import { describe, expect, it } from "vitest";
import {
  type ServerActivityEvent,
  serverActivityToLogEntry,
} from "./server-activity";

function event(
  overrides: Partial<ServerActivityEvent> = {},
): ServerActivityEvent {
  return {
    id: "abc",
    timestamp: 1000,
    direction: "inbound",
    method: "POST",
    url: "/api/pas/notification",
    status: 200,
    operationName: "PAS Notification (decision)",
    category: "pas-decision",
    requestBody: { resourceType: "Bundle" },
    responseBody: { resourceType: "Bundle", type: "transaction-response" },
    ...overrides,
  };
}

describe("serverActivityToLogEntry", () => {
  it("maps an inbound event to a server-tagged log entry", () => {
    const entry = serverActivityToLogEntry(event());
    expect(entry.id).toBe("server-abc");
    expect(entry.source).toBe("server");
    expect(entry.serverName).toBe("Payer → Provider");
    expect(entry.operationName).toBe("PAS Notification (decision)");
    expect(entry.error).toBe(false);
    expect(entry.requestBody).toEqual({ resourceType: "Bundle" });
  });

  it("flags 4xx/5xx statuses as errors and labels outbound direction", () => {
    const entry = serverActivityToLogEntry(
      event({ status: 500, direction: "outbound" }),
    );
    expect(entry.error).toBe(true);
    expect(entry.serverName).toBe("Provider → Payer");
  });
});

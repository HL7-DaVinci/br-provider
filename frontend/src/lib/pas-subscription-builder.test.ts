import { describe, expect, it } from "vitest";
import { buildPasSubscription } from "./pas-subscription-builder";

const BACKPORT_FILTER_CRITERIA =
  "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-filter-criteria";
const BACKPORT_PAYLOAD_CONTENT =
  "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-payload-content";

describe("buildPasSubscription", () => {
  const sub = buildPasSubscription({
    orgIdentifier: "1122334455",
    notificationUrl: "http://provider.example/api/pas/notification",
  });

  it("targets the PAS subscription topic with the PAS + backport profiles", () => {
    expect(sub.criteria).toBe(
      "http://hl7.org/fhir/us/davinci-pas/SubscriptionTopic/PASSubscriptionTopic",
    );
    expect(sub.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-subscription",
    );
    expect(sub.status).toBe("requested");
  });

  it("filters notifications by orgIdentifier via backport-filter-criteria", () => {
    const filter = sub._criteria?.extension?.find(
      (e) => e.url === BACKPORT_FILTER_CRITERIA,
    );
    expect(filter?.valueString).toBe("Bundle?orgIdentifier=1122334455");
  });

  it("configures a full-resource rest-hook channel at the notification URL", () => {
    expect(sub.channel.type).toBe("rest-hook");
    expect(sub.channel.endpoint).toBe(
      "http://provider.example/api/pas/notification",
    );
    expect(sub.channel.payload).toBe("application/fhir+json");
    const payloadContent = sub.channel._payload?.extension?.find(
      (e) => e.url === BACKPORT_PAYLOAD_CONTENT,
    );
    expect(payloadContent?.valueCode).toBe("full-resource");
  });

  it("does not set a channel.header", () => {
    expect(sub.channel.header ?? []).toHaveLength(0);
  });
});

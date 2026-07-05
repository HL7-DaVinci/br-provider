import type { Subscription } from "fhir/r4";

/**
 * Builds a Da Vinci PAS rest-hook Subscription the provider POSTs to the payer so it is notified
 * when a pended prior authorization is finalized.
 */

const SUBSCRIPTION_TOPIC =
  "http://hl7.org/fhir/us/davinci-pas/SubscriptionTopic/PASSubscriptionTopic";
const PROFILE_SUBSCRIPTION =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-subscription";
const BACKPORT_SUBSCRIPTION =
  "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-subscription";
const BACKPORT_FILTER_CRITERIA =
  "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-filter-criteria";
const BACKPORT_PAYLOAD_CONTENT =
  "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-payload-content";

export interface PasSubscriptionParams {
  /** Provider org identifier the payer matches to route notifications. */
  orgIdentifier: string;
  /** Provider rest-hook endpoint the payer delivers notifications to. */
  notificationUrl: string;
}

export function buildPasSubscription({
  orgIdentifier,
  notificationUrl,
}: PasSubscriptionParams): Subscription {
  return {
    resourceType: "Subscription",
    meta: { profile: [PROFILE_SUBSCRIPTION, BACKPORT_SUBSCRIPTION] },
    status: "requested",
    reason: "Monitor PAS authorization notifications via REST hook",
    criteria: SUBSCRIPTION_TOPIC,
    _criteria: {
      extension: [
        {
          url: BACKPORT_FILTER_CRITERIA,
          valueString: `orgIdentifier=${orgIdentifier}`,
        },
      ],
    },
    channel: {
      type: "rest-hook",
      endpoint: notificationUrl,
      payload: "application/fhir+json",
      _payload: {
        extension: [
          { url: BACKPORT_PAYLOAD_CONTENT, valueCode: "full-resource" },
        ],
      },
    },
  };
}

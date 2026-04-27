package org.hl7.davinci.security;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class SmartScopes {

    private static final List<String> DTR_RESOURCE_TYPES = List.of(
        "Patient",
        "Coverage",
        "Questionnaire",
        "QuestionnaireResponse",
        "Encounter",
        "ServiceRequest",
        "MedicationRequest",
        "DeviceRequest",
        "Appointment",
        "NutritionOrder",
        "VisionPrescription",
        "CommunicationRequest",
        "Task",
        "Condition",
        "Observation",
        "DocumentReference"
    );

    private SmartScopes() {}

    public static Set<String> supportedScopes() {
        LinkedHashSet<String> scopes = new LinkedHashSet<>();
        scopes.add("launch");
        scopes.add("launch/patient");
        scopes.add("launch/encounter");
        scopes.add("openid");
        scopes.add("fhirUser");
        scopes.add("profile");
        scopes.add("online_access");
        scopes.add("offline_access");
        scopes.add("udap");
        scopes.add("patient/*.read");
        scopes.add("patient/*.rs");
        scopes.add("patient/*.write");
        scopes.add("patient/*.cruds");
        scopes.add("user/*.read");
        scopes.add("user/*.rs");
        scopes.add("user/*.write");
        scopes.add("user/*.cruds");
        scopes.add("system/*.read");
        scopes.add("system/*.rs");
        for (String type : DTR_RESOURCE_TYPES) {
            scopes.add("patient/" + type + ".read");
            scopes.add("patient/" + type + ".rs");
            scopes.add("patient/" + type + ".write");
            scopes.add("patient/" + type + ".cruds");
            scopes.add("user/" + type + ".read");
            scopes.add("user/" + type + ".rs");
            scopes.add("user/" + type + ".write");
            scopes.add("user/" + type + ".cruds");
        }
        return scopes;
    }
}

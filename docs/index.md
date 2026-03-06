# Burden Reduction Provider Reference Implementation

A reference FHIR server that implements the HL7 Da Vinci Burden Reduction implementation guides from the provider side.

The server builds on [HAPI FHIR JPA Starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter).

## Running

Run the server and frontend together with Nx (recommended for development):

```bash
bun install
bun serve
```

Alternatively, run the server and frontend separately:

```bash
# Server
cd server
mvn spring-boot:run
```
```bash
# Frontend
cd frontend
bun dev
```


## Implementation guide specs

| IG | Spec |
|----|------|
| CRD | <https://build.fhir.org/ig/HL7/davinci-crd/> |
| DTR | <https://build.fhir.org/ig/HL7/davinci-dtr/> |
| PAS | <https://build.fhir.org/ig/HL7/davinci-pas/> |

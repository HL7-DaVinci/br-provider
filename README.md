# DaVinci Burden Reduction Provider Server

This is a reference implementation FHIR server built on the [HAPI FHIR JPA Starter Server](https://github.com/hapifhir/hapi-fhir-jpaserver-starter) in an [Nx](https://nx.dev) workspace.

It implements the following Da Vinci implementation guides:
- [Coverage Requirements Discovery (CRD)](https://build.fhir.org/ig/HL7/davinci-crd/)
- [Documentation Templates and Rules (DTR)](https://build.fhir.org/ig/HL7/davinci-dtr/)
- [Prior Authorization Support (PAS)](https://build.fhir.org/ig/HL7/davinci-pas/)

This server is intended to support the burden reduction uses cases from the provider side.

The corresponding payer reference implementation is available at <https://github.com/HL7-DaVinci/br-payer>

## Prerequisites

- Required to run the server
  - Java 17+
  - Maven
- Required to run the frontend
  - Bun 1+ (generally tested with latest) or Node 22+
- Optional
  - Docker

## Quick Start

### Option 1: Run with Nx

The easiest way to run everything in development mode:

```bash
# Install dependencies
bun install

# Start the FHIR server and frontend concurrently
bun serve
```

The server will be available at `http://localhost:8080/fhir` and the frontend at `http://localhost:3000`

### Option 2: Run Separately


Navigate to the server directory and use Maven directly:

```bash
cd server
mvn spring-boot:run
```

### Option 3: Run with Docker

Build and run the server and frontend using Docker:

```bash
# Build the Docker image (this packages the frontend and server together)
docker build -t br-provider .

# Run the container
docker run -p 8080:8080 br-provider
```

The frontend will be available at `http://localhost:8080` with the FHIR endpoint at `http://localhost:8080/fhir`


### Option 4: Run with Docker Compose

A Docker Compose file is provided to run the provider server alongside the payer reference implementation and the FAST Security server.

```bash
docker compose up
```

## Local Inferno Usage

A running burden reduction client with a functional UI is very helpful
when developing Inferno test kits. The DTR test kit in particular benefits
from observing the interaction in the UI. However, the standard br-provider
functionality does not fully support all DTR capabilities. This inferno-specific
fork provides a sandbox for the team to add quick, AI-authored, non-general
updates to support features that enable Inferno test validation locally.

### Running with Inferno

Run br-provider with its other components (br-payer and fast-security) using docker:

```
docker compose up -d
```

Note that it will take a few minutes to start-up. Additional configuration is
needed to run against specific test kits.

#### CRD

TODO

#### DTR

With the br-provider docker container running locally, Inferno services running
in docker, and the dtr test kit running locally in Ruby, you can test your
local br-provider instances against the Inferno DTR tests.

In the br-provider settings for the Payer, use the following values:
- CDS Services URL: `http://localhost:8081/cds-services` (uses the br-payer service)
- FHIR URL: `http://host.docker.internal:4567/custom/dtr_full_ehr_v220/fhir` (NOTE: run over an internal docker host - generates some errors in Inferno around mismatched hosts, but works)
- Authentication: `SMART Backend Services`
- Client ID: `dtr_v220_smart`
- Bypass payor-handled checks: checked

In Inferno, start a DTR v2.2.0 client suite and run the Registration group
with the following inputs (paste as json). Note that the `client_id`
value is configured within the br-provider `application.yaml` file.
```
[
  {
    "name": "client_id",
    "value": "dtr_v220_smart"
  },
  {
    "name": "smart_jwk_set",
    "value": "http://localhost:8080/api/security/jwks"
  }
]
```

After attesting to the completion of registration, you can start any Inferno
group to wait for a DTR request. In the [br-provider UI](http://localhost:8080/login),
you can then
- Login as a provider (e.g., Jane Doe)
- Choose a patient (e.g., Teddy Roosevelt)
- Start an Encounter
- Place an order (e.g., "EO424 - Stationary Compressed Gas Oxygen")
- Sign it and confirm
- Launch DTR using the button that shows up

Additional variations in the UI are possible, but not documented here.

#### PAS

TODO

### Updates

If you make updates to add or adjust functionality, bring docker down (`docker compose down`) and then run again building br-provider:

```
docker compose up -d --build br-provider
```
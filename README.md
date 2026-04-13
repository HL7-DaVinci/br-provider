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

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors


<!-- nx configuration end-->

# Workspace Overview

This is an Nx workspace designed to host a FHIR application stack. The stack provides a SPA frontend and a HAPI FHIR Java server backend. The use cases handled include implementing the Da Vinci Burden Reduction implementation guides, with a focus on provider-side functionality.


## Build & Run Commands

This is an Nx workspace. Prefer running tasks through `nx` instead of underlying tooling.

```bash
# Install dependencies
bun install

# Start both server and frontend
bun serve

# Build all projects
bun run build

# Run all tests
bun run test
```

### Server (Java/Maven)

```bash
# Run server directly with Maven
cd server && mvn spring-boot:run

# Run a single test class
cd server && mvn test -Dtest=OrderSelectServiceTest

# Run a single test method
cd server && mvn test -Dtest=OrderSelectServiceTest#testMethodName

# Build server WAR
cd server && mvn clean package -DskipTests
```

### Frontend (Vite/React)

```bash
# Run frontend dev server (port 3000)
cd frontend && bun dev

# Run frontend tests
cd frontend && bun test

# Lint/format
cd frontend && bun check    # biome check
cd frontend && bun lint     # biome lint
cd frontend && bun format   # biome format

# Build and copy to server static resources
nx run frontend:copy-to-server
```

## Projects

### 1. Server (`server`)
- **Path**: `server/`
- **Type**: Java / Maven / HAPI FHIR
- **Description**: The backend FHIR server.
- **Structure**:
  - `src/main/java/ca/uhn/fhir/` - HAPI starter code (do NOT modify)
  - `src/main/java/org/hl7/davinci/` - Custom implementation code (all custom code goes here)
    - `api/` - REST controllers for non-FHIR APIs
    - `common/` - Shared utilities and base classes
    - `config/` - Spring configuration classes

### 2. Frontend (`frontend`)
- **Path**: `frontend/`
- **Type**: TanStack React Router SPA
- **Description**: Contains a frontend application simulating a clinical experience from the provider perspective.

---

## Implementation Guide References

This server implements the Da Vinci Burden Reduction implementation guides. Always consult these when implementing features:

| IG | Build URL | Key Sections |
|----|-----------|--------------|
| **CRD** (Coverage Requirements Discovery) | https://build.fhir.org/ig/HL7/davinci-crd/en/ | [Hooks](https://build.fhir.org/ig/HL7/davinci-crd/en/hooks.html), [Cards](https://build.fhir.org/ig/HL7/davinci-crd/en/cards.html), [CodeSystem](https://build.fhir.org/ig/HL7/davinci-crd/en/CodeSystem-temp.html) |
| **DTR** (Documentation Templates and Rules) | https://build.fhir.org/ig/HL7/davinci-dtr/en/ | [Specification](https://build.fhir.org/ig/HL7/davinci-dtr/en/specification.html), [Expected Systems](https://build.fhir.org/ig/HL7/davinci-dtr/en/index.html#expected-systems) |
| **PAS** (Prior Authorization Support) | https://build.fhir.org/ig/HL7/davinci-pas/en/ | [Specification](https://build.fhir.org/ig/HL7/davinci-pas/en/specification.html) |
| **CDS Hooks** | https://cds-hooks.org/specification/current/ | [Discovery](https://cds-hooks.org/specification/current/#discovery), [HTTP Response](https://cds-hooks.org/specification/current/#http-response) |

**Important**: This server is a **provider** implementation. It does NOT implement payer functionality.


## Configuration

- Main: `server/src/main/resources/application.yaml`

### Maven Profiles

| Profile | Default | Purpose |
|---------|---------|---------|
| `boot` | Yes | Spring Boot embedded Tomcat (development) |
| `jetty` | No | Replace Tomcat with Jetty (`mvn -Pjetty spring-boot:run`) |

## Key Constraints

1. **Do NOT modify HAPI starter code** in `src/main/java/ca/uhn/fhir/` - place custom code in `org.hl7.davinci`
2. **Provider-only scope** - This server implements provider operations
3. **H2 in-memory database** - Data is transient and reloaded each startup

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
- **Type**: Java / Maven / HAPI FHIR 8.8.0 / Spring Boot 3.5.9
- **Description**: The backend FHIR server (R4) and OAuth2 authorization server.
- **Structure**:
  - `src/main/java/ca/uhn/fhir/` - HAPI starter code (do NOT modify)
  - `src/main/java/org/hl7/davinci/` - Custom implementation code (all custom code goes here)
    - `api/` - REST controllers for non-FHIR endpoints (UserController, ApiController)
    - `common/` - Shared utilities and base classes (BaseProvider, BaseInterceptor)
    - `config/` - Spring configuration classes (CORS, beans)
    - `datainitializer/` - Seed data loading on startup from `initial-data` directories
    - `security/` - Auth stack (see Authentication section below)
- **Database**: H2 in-memory (transient, reloaded each startup). PostgreSQL-ready via config.
- **IGs**: CRD, DTR, PAS (v2.2.0) loaded from `hapi.fhir.implementationguides` in application.yaml

### 2. Frontend (`frontend`)
- **Path**: `frontend/`
- **Type**: React 19 SPA with TanStack Router (file-based routing), TanStack Query, TanStack Table
- **Styling**: Tailwind CSS 4 + Radix UI components
- **Linting**: Biome (lint + format)
- **Testing**: Vitest + Testing Library
- **Description**: Clinical experience UI from the provider perspective.
- **Key directories**:
  - `src/routes/` - File-based routing (`routeTree.gen.ts` is auto-generated, do not edit)
  - `src/hooks/` - React hooks (auth, FHIR API, server selection, theme)
  - `src/lib/` - Core utilities (auth/PKCE client, FHIR config, types)
  - `src/components/ui/` - Radix-based UI primitives
- **Path alias**: `@/` maps to `frontend/src/`
- **Dev proxy**: Vite forwards `/fhir`, `/auth`, `/oauth2`, `/.well-known`, `/api`, `/actuator` to localhost:8080

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


## Authentication & Security

This server is the **Identity Provider (IdP)** in a UDAP Tiered OAuth flow. The **FAST Security RI** (configured at `security.issuer`, default `https://localhost:5001`) is the trust community authorization server that issues tokens.

### UDAP Tiered OAuth Flow
1. At startup, this server registers as a UDAP client with the FAST RI (`UdapClientRegistration` discovers endpoints from `{issuer}/.well-known/udap`, then performs DCR)
2. `CertificateHolder` fetches an X.509 certificate from the FAST RI (`{issuer}/api/cert/generate`) for signing
3. Frontend calls `/auth/login` -> `SpaAuthController` redirects to the FAST RI's authorize endpoint with `&idp={this-server-url}` to indicate this server as the IdP
4. FAST RI uses Tiered OAuth to redirect back to this server's IdP endpoints for user authentication
5. User authenticates locally against the provider's Spring Authorization Server
6. FAST RI issues tokens; frontend receives them via `/auth/token` (private_key_jwt exchange)
7. Tokens stored in browser sessionStorage; FHIR requests use `Authorization: Bearer` header
8. `TokenValidator` validates FAST RI-issued JWTs against the FAST RI's published JWKS

### Two UDAP Discovery Endpoints
- **`/fhir/.well-known/udap`** (resource server discovery via `UdapDiscoveryInterceptor`) - authorization/token endpoints point to the FAST RI
- **`/.well-known/udap`** (IdP discovery via `UdapIdpDiscoveryController`) - endpoints point to this server's own Spring Authorization Server; used by the FAST RI during Tiered OAuth to discover IdP capabilities and register as a client

### UDAP DCR on this server
`UdapRegistrationController` accepts dynamic client registrations from the FAST RI (and other UDAP clients). Client IDs are deterministic (UUID derived from issuer) to handle the FAST RI's `UpsertTieredClient` re-registration behavior.

### Security module (`org.hl7.davinci.security/`)
- `AuthorizationServerConfig` - Spring OAuth2 Authorization Server (local IdP)
- `SpaAuthController` - SPA auth endpoints (`/auth/login`, `/auth/token`, `/auth/callback`)
- `UdapClientRegistration` - Registers this server with the FAST RI at startup
- `UdapRegistrationController` - Accepts UDAP DCR from the FAST RI
- `UdapIdpDiscoveryController` - IdP discovery at `/.well-known/udap`
- `UdapDiscoveryInterceptor` - Resource server discovery at `/fhir/.well-known/udap`
- `CertificateHolder` - X.509 certificate fetching/management
- `TokenValidator` - Validates FAST RI-issued JWTs via remote JWKS
- `AuthInterceptor` - FHIR request authentication
- `SecurityProperties` - Externalized config (bound to `security.*` in application.yaml)

### Auth bypass (development)
The `X-Bypass-Auth` header can skip authentication (configured via `security.bypass-header`).

---

## Configuration

- Main: `server/src/main/resources/application.yaml`

### Maven Profiles

| Profile | Default | Purpose |
|---------|---------|---------|
| `boot` | Yes | Spring Boot embedded Tomcat (development) |
| `jetty` | No | Replace Tomcat with Jetty (`mvn -Pjetty spring-boot:run`) |

### Dev URLs
- Server: http://localhost:8080/fhir
- Frontend: http://localhost:3000
---

## Deployment

Multi-stage Dockerfile: frontend (bun/vite) -> docs (mkdocs-material) -> server (maven) -> distroless Java 17 image. Drone CI handles multi-arch builds (amd64/arm64) and publishes to `hlseven/davinci-br-provider`.

The frontend build is copied into `server/src/main/resources/static/` so the production WAR serves the SPA directly from port 8080.

---

## Key Constraints

1. **Do NOT modify HAPI starter code** in `src/main/java/ca/uhn/fhir/` - place custom code in `org.hl7.davinci`
2. **Provider-only scope** - This server implements provider operations, not payer
3. **H2 in-memory database** - Data is transient and reloaded each startup
4. **Do not edit `routeTree.gen.ts`** - Auto-generated by TanStack Router plugin from `src/routes/`
5. **Use `bun`** instead of `npm`, `npx`, or `node` for all frontend/workspace commands

# Burden Reduction Provider Reference Implementation

A reference FHIR server that implements the HL7 Da Vinci Burden Reduction implementation guides from the provider side.

The server builds on [HAPI FHIR JPA Starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter).

## Running

Run the server and frontend together with Nx (recommended for development):

=== "bun"

    ```bash
    bun install
    bun serve
    ```

=== "npm"

    ```bash
    npm install
    npm run serve
    ```

`bun` is the recommended toolchain, and `bun.lock` is the only lockfile checked
into the repository. The package scripts name `node` internally rather than
`bun`, so every script also runs under npm if you cannot install bun.

Alternatively, run the server and frontend separately:

```bash
# Server
cd server
mvn spring-boot:run
```

=== "bun"

    ```bash
    # Frontend
    cd frontend
    bun dev
    ```

=== "npm"

    ```bash
    # Frontend
    cd frontend
    npm run dev
    ```

## Running the full stack with Docker

The repository root holds a Compose file that runs the three Burden Reduction
services together.

```bash
docker compose up -d --wait
```

| Service | URL |
|---------|-----|
| Provider | <http://localhost:8080> (frontend, with FHIR at `/fhir`) |
| Payer | <http://localhost:8081/fhir> |
| FAST Security | <https://localhost:5001> |

The FHIR servers need a short time after the containers report healthy before
they answer requests.

```bash
docker compose down
```

## End-to-end tests

The Playwright suite drives a browser against a running stack. Install the
browser once per machine, because installing dependencies does not download it.

```bash
cd frontend
bunx playwright install chromium
```

`e2e:stack` boots the Compose stack, runs the suite, then tears the stack down.
It performs the browser install step for you. The harness is plain JavaScript,
so it needs no bash shell and runs on Windows.

=== "bun"

    ```bash
    cd frontend
    bun e2e:stack
    ```

=== "npm"

    ```bash
    cd frontend
    npm run e2e:stack
    ```

Where the Playwright browser CDN is unreachable, run a browser that is already
installed instead. This accepts `chrome` or `msedge`, and Edge ships with
Windows. No download happens in this mode.

```bash
E2E_BROWSER_CHANNEL=msedge bun e2e:stack
```

The E2E stack adds [fhir-candle](https://github.com/FHIR/fhir-candle) as a
stand-in external EHR. It is a test fixture rather than part of this
implementation, so a Compose profile keeps it out of a plain
`docker compose up`. To run it by hand, pass the profile to both commands.

```bash
docker compose --profile e2e up -d --wait
docker compose --profile e2e down
```

A plain `docker compose down` leaves a profiled container running, so pass the
profile when tearing down.

## Implementation guide specs

| IG | Spec |
|----|------|
| CRD | <https://build.fhir.org/ig/HL7/davinci-crd/> |
| DTR | <https://build.fhir.org/ig/HL7/davinci-dtr/> |
| PAS | <https://build.fhir.org/ig/HL7/davinci-pas/> |

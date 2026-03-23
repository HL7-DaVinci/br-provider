import { Link } from "@tanstack/react-router";

export function LandingPage() {
  return (
    <div className="p-6 md:p-10 max-w-3xl space-y-8">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Da Vinci Burden Reduction Provider
        </h1>
        <p className="text-muted-foreground leading-relaxed max-w-[65ch]">
          A test clinical portal for trying out the Da Vinci Burden Reduction
          IGs from the provider side. Supports CRD, DTR, and PAS workflows
          against a FHIR R4 server with seed data.
        </p>
      </div>

      <Link
        to="/login"
        search={{ error: undefined }}
        className="inline-block cursor-pointer rounded-md bg-brand px-8 py-3 text-base font-medium text-brand-foreground transition-colors hover:bg-brand/85 active:scale-[0.98]"
      >
        Sign In
      </Link>

      <div className="space-y-4 border-t pt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Supported workflows
        </h2>
        <dl className="divide-y">
          <div className="py-3">
            <dt className="text-sm font-medium">
              Coverage Requirements Discovery (CRD)
            </dt>
            <dd className="text-sm text-muted-foreground mt-0.5 max-w-[65ch]">
              CDS Hooks integration that returns coverage requirements at the
              point of order entry.
            </dd>
          </div>
          <div className="py-3">
            <dt className="text-sm font-medium">
              Documentation Templates and Rules (DTR)
            </dt>
            <dd className="text-sm text-muted-foreground mt-0.5 max-w-[65ch]">
              SMART on FHIR app that auto-populates payer forms using data from
              the clinical system.
            </dd>
          </div>
          <div className="py-3">
            <dt className="text-sm font-medium">
              Prior Authorization Support (PAS)
            </dt>
            <dd className="text-sm text-muted-foreground mt-0.5 max-w-[65ch]">
              FHIR-based prior auth submission and tracking, replacing fax and
              phone workflows.
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

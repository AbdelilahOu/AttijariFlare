import type { Bindings } from "@finance-ttijari/api/bindings";
import type { ServerEnv } from "@finance-ttijari/infra/alchemy.run";

// This file infers types for the cloudflare:workers environment from your Alchemy Worker.
// @see https://alchemy.run/cloudflare/compute/workers
//
// Alchemy infers queues as Queue<unknown> and has no Vectorize mapping, so those bindings
// take their types from the shared Bindings contract instead.
type OverriddenBindings = "STATEMENT_INGEST" | "TXN_ENRICH" | "VECTORIZE";

export type CloudflareEnv = Omit<ServerEnv, OverriddenBindings> &
  Pick<Bindings, OverriddenBindings>;

declare global {
  type Env = CloudflareEnv;
}

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends CloudflareEnv {}
  }
}

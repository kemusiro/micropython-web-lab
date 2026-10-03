declare module "virtual:optional-content-integration" {
  import type {
    OptionalContentContext,
    OptionalContentIntegration,
  } from "./integration/optional-content";

  export function createOptionalContentIntegration(
    context: OptionalContentContext,
  ): OptionalContentIntegration;
}

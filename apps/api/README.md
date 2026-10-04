# Reclaim backend (to be built)

Implement the routes in `packages/shared/src/routes.ts` and validate every response with the schemas in `packages/shared/src/schemas.ts`. The frontend's `HttpApiClient` (`apps/web/src/api/http`) is the consumer.

Run the frontend against it with `VITE_API_MODE=http VITE_API_BASE=http://localhost:3000`.

The mock client in `apps/web/src/api/mock` shows the expected behaviour of every route, including delays, events and the 412 path. The rules engine, SAP payload builder and narrative templates live in `packages/shared` and can be imported directly.

The test in `apps/web/src/api/mock/__tests__/pipeline.test.ts` is the acceptance test: the real backend must produce the same decisions for the eight demo cases.

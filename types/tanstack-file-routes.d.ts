import type { AnyRoute } from "@tanstack/react-router";

/**
 * Registro tipado de las rutas de servidor (src/server-routes/api/**) en el
 * `FileRoutesByPath` de TanStack Router.
 *
 * Este repo no genera `src/routeTree.gen.ts` (las rutas de servidor no forman
 * parte del árbol de rutas del cliente), por lo que `FileRoutesByPath` queda
 * vacío y `createFileRoute("/api/...")` no resuelve. Cada entrada declara la
 * forma mínima que consume `createFileRoute`: `parentRoute`, `id`, `path` y
 * `fullPath`. Las rutas de servidor no tienen ruta padre registrada, por eso
 * `parentRoute` es `AnyRoute`.
 */
declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/api/isabella": {
      parentRoute: AnyRoute;
      id: "/api/isabella";
      path: "/api/isabella";
      fullPath: "/api/isabella";
    };
    "/api/catalog": {
      parentRoute: AnyRoute;
      id: "/api/catalog";
      path: "/api/catalog";
      fullPath: "/api/catalog";
    };
    "/api/ncua-load": {
      parentRoute: AnyRoute;
      id: "/api/ncua-load";
      path: "/api/ncua-load";
      fullPath: "/api/ncua-load";
    };
    "/api/observability": {
      parentRoute: AnyRoute;
      id: "/api/observability";
      path: "/api/observability";
      fullPath: "/api/observability";
    };
    "/api/video-engine-x": {
      parentRoute: AnyRoute;
      id: "/api/video-engine-x";
      path: "/api/video-engine-x";
      fullPath: "/api/video-engine-x";
    };
    "/api/v1/api-keys": {
      parentRoute: AnyRoute;
      id: "/api/v1/api-keys";
      path: "/api/v1/api-keys";
      fullPath: "/api/v1/api-keys";
    };
    "/api/v1/api-keys/rotate": {
      parentRoute: AnyRoute;
      id: "/api/v1/api-keys/rotate";
      path: "/api/v1/api-keys/rotate";
      fullPath: "/api/v1/api-keys/rotate";
    };
    "/api/v1/images/generate": {
      parentRoute: AnyRoute;
      id: "/api/v1/images/generate";
      path: "/api/v1/images/generate";
      fullPath: "/api/v1/images/generate";
    };
    "/api/v1/language/profile": {
      parentRoute: AnyRoute;
      id: "/api/v1/language/profile";
      path: "/api/v1/language/profile";
      fullPath: "/api/v1/language/profile";
    };
    "/api/v1/quantum/telemetry": {
      parentRoute: AnyRoute;
      id: "/api/v1/quantum/telemetry";
      path: "/api/v1/quantum/telemetry";
      fullPath: "/api/v1/quantum/telemetry";
    };
  }
}

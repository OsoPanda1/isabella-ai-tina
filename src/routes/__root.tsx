import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { useEffect, useMemo, type ReactNode } from "react";
import { IsabellaErrorBoundary } from "@/components/isabella/ErrorBoundary";
import { EmergencyModeView } from "@/components/isabella/EmergencyModeView";

import appCss from "../styles.css?inline";

export function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página no encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">La ruta solicitada no existe.</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Volver a Isabella
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const err = useMemo(
    () => (error instanceof Error ? error : new Error(String(error ?? "Error de ejecución"))),
    [error],
  );
  console.error("[Isabella] root error", err);
  const router = useRouter();
  useEffect(() => {
    console.error("[Isabella] root error detail", {
      message: err.message,
      stack: err.stack,
    });
  }, [err]);

  return (
    <EmergencyModeView
      mode="critical_error"
      errorDetails={{
        code: "CROWN-RENDER-MOUNT-FAIL",
        message: err.message || "Error crítico durante el montaje de la ruta raíz.",
      }}
      onRetry={() => {
        void router.invalidate();
        if (typeof reset === "function") reset();
      }}
    />
  );
}

export const Route = createRootRouteWithContext()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Isabella Villaseñor AI" },
      {
        name: "description",
        content: "Isabella Villaseñor AI — sistema federado de inteligencia artificial gobernada.",
      },
      { property: "og:title", content: "Isabella Villaseñor AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "icon", href: "/favicon.ico", type: "image/x-icon" }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

export function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className="bg-background">
      <head>
        <HeadContent />
        <style dangerouslySetInnerHTML={{ __html: appCss }} />
      </head>
      <body>
        {children}
        <SpeedInsights />
        <Scripts />
      </body>
    </html>
  );
}

export function RootComponent() {
  return (
    <IsabellaErrorBoundary>
      <Outlet />
    </IsabellaErrorBoundary>
  );
}

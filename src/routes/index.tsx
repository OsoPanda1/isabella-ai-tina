/**
 * Root Route (src/routes/index.tsx)
 * -------------------------------------------------------------
 * Canonical root application view rendering App.
 */
import { createFileRoute } from "@tanstack/react-router";
import "react";
import App from "../App";

export const Route = createFileRoute("/")({
  component: IndexRoute,
});

export default function IndexRoute() {
  return <App />;
}

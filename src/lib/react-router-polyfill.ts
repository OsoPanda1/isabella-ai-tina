import { createElement } from "react";
import { navigate } from "./navigation";

export function createFileRoute(path: string) {
  return (opts: any) => {
    return opts.component;
  };
}

export function Link({ to, children, className, activeProps }: any) {
  return createElement(
    "a",
    {
      href: "#",
      onClick: (e: any) => {
        e.preventDefault();
        navigate(to);
      },
      className,
    },
    children,
  );
}

export function useRouter() {
  return { invalidate: async () => {} };
}

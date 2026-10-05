export const navEvent = new EventTarget();

export function navigate(to: string) {
  navEvent.dispatchEvent(new CustomEvent("navigate", { detail: to }));
}

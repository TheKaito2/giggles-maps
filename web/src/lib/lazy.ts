import { type ComponentType, createElement, lazy, type LazyExoticComponent } from "react";

// React.lazy remembers a failed load for good: a screen first opened offline stayed broken after the connection came
// back ("This part didn't load") until a full reload. These screens start a fresh lazy() after a failure, so the next
// render fetches the code again (the browser does retry a failed dynamic import).
const resets = new Set<() => void>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let Screen: LazyExoticComponent<T> = lazy(load);
  resets.add(() => { Screen = lazy(load); });
  const Retrying = (props: React.ComponentProps<T>) => createElement(Screen, props);
  return Retrying as unknown as T;
}

/** After a screen failed to load: the next time any of them renders, its code is fetched again. */
export const retryScreens = () => resets.forEach((reset) => reset());

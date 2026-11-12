import { useEffect, useRef, type ReactNode } from "react";
import { useApp } from "../state/app-state.tsx";
import { useCopy } from "../state/copy-mode.tsx";
import { mountFamilyHeader, type ProductHeaderApi } from "../lib/family-header.ts";

/**
 * Centered five-product appbar for the desktop header. Purely presentational:
 * mount the shared renderer; status is the vault lock state, and opening a
 * product goes through the native family_switch command (catalog id only).
 */
export function FamilyProductHeader(): ReactNode {
  const { lockState } = useApp();
  const { lang } = useCopy();
  const ref = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ProductHeaderApi | null>(null);
  const lockRef = useRef(lockState);
  lockRef.current = lockState;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    void mountFamilyHeader(element, { locale: lang, lockState: () => lockRef.current }).then(
      (api) => {
        if (cancelled) api.destroy();
        else apiRef.current = api;
      },
    );
    return () => {
      cancelled = true;
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // Mount once; locale changes are applied via setLocale below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiRef.current?.setLocale(lang);
  }, [lang]);

  return <div className="family-product-header" ref={ref} aria-label="Family products" />;
}

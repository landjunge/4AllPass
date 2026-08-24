import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  loadCopyMode,
  pick,
  saveCopyMode,
  type CopyMode,
  type Line,
} from "../lib/copy-mode.ts";

interface CopyModeValue {
  mode: CopyMode;
  plain: boolean;
  setPlain: (on: boolean) => void;
  t: (plain: Line, expert?: Line) => string;
}

const CopyModeContext = createContext<CopyModeValue | null>(null);

export function CopyModeProvider({ children }: { children: ReactNode }): ReactNode {
  const [mode, setMode] = useState<CopyMode>(() => loadCopyMode());
  const setPlain = useCallback((on: boolean) => {
    const next: CopyMode = on ? "plain" : "expert";
    saveCopyMode(next);
    setMode(next);
  }, []);
  const t = useCallback((plain: Line, expert?: Line) => pick(mode, plain, expert), [mode]);
  const value = useMemo(
    () => ({ mode, plain: mode === "plain", setPlain, t }),
    [mode, setPlain, t],
  );
  return <CopyModeContext.Provider value={value}>{children}</CopyModeContext.Provider>;
}

export function useCopy(): CopyModeValue {
  const context = useContext(CopyModeContext);
  if (!context) throw new Error("useCopy must be used inside CopyModeProvider");
  return context;
}

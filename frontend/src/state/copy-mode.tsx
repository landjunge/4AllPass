import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  loadCopyMode,
  loadLanguage,
  pick,
  saveCopyMode,
  saveLanguage,
  type CopyMode,
  type Language,
  type Line,
} from "../lib/copy-mode.ts";

interface CopyModeValue {
  mode: CopyMode;
  plain: boolean;
  setPlain: (on: boolean) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  t: (plain: Line, expert?: Line) => string;
}

const CopyModeContext = createContext<CopyModeValue | null>(null);

export function CopyModeProvider({ children }: { children: ReactNode }): ReactNode {
  const [mode, setMode] = useState<CopyMode>(() => loadCopyMode());
  const [language, setLanguageState] = useState<Language>(() => loadLanguage());
  const setPlain = useCallback((on: boolean) => {
    const next: CopyMode = on ? "plain" : "expert";
    saveCopyMode(next);
    setMode(next);
  }, []);
  const setLanguage = useCallback((next: Language) => {
    saveLanguage(next);
    setLanguageState(next);
  }, []);
  const t = useCallback(
    (plain: Line, expert?: Line) => pick(mode, language, plain, expert),
    [language, mode],
  );
  const value = useMemo(
    () => ({ mode, plain: mode === "plain", setPlain, language, setLanguage, t }),
    [language, mode, setLanguage, setPlain, t],
  );
  return <CopyModeContext.Provider value={value}>{children}</CopyModeContext.Provider>;
}

export function useCopy(): CopyModeValue {
  const context = useContext(CopyModeContext);
  if (!context) throw new Error("useCopy must be used inside CopyModeProvider");
  return context;
}

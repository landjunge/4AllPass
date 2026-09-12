import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  loadCopyMode,
  loadLang,
  pick,
  saveCopyMode,
  saveLang,
  type CopyMode,
  type Lang,
  type Line,
} from "../lib/copy-mode.ts";

interface CopyModeValue {
  mode: CopyMode;
  plain: boolean;
  setPlain: (on: boolean) => void;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (plain: Line, expert?: Line) => string;
}

const CopyModeContext = createContext<CopyModeValue | null>(null);

export function CopyModeProvider({ children }: { children: ReactNode }): ReactNode {
  const [mode, setMode] = useState<CopyMode>(() => loadCopyMode());
  const [lang, setLangState] = useState<Lang>(() => loadLang());
  const setPlain = useCallback((on: boolean) => {
    const next: CopyMode = on ? "plain" : "expert";
    saveCopyMode(next);
    setMode(next);
  }, []);
  const setLang = useCallback((next: Lang) => {
    saveLang(next);
    setLangState(next);
  }, []);
  const t = useCallback(
    (plain: Line, expert?: Line) => pick(mode, lang, plain, expert),
    [mode, lang],
  );
  const value = useMemo(
    () => ({ mode, plain: mode === "plain", setPlain, lang, setLang, t }),
    [mode, setPlain, lang, setLang, t],
  );
  return <CopyModeContext.Provider value={value}>{children}</CopyModeContext.Provider>;
}

export function useCopy(): CopyModeValue {
  const context = useContext(CopyModeContext);
  if (!context) throw new Error("useCopy must be used inside CopyModeProvider");
  return context;
}

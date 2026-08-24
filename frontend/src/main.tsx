import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import { AppProvider } from "./state/app-state.tsx";
import { CopyModeProvider } from "./state/copy-mode.tsx";
import "./styles.css";

registerSW({ immediate: true });

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    <CopyModeProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </CopyModeProvider>
  </StrictMode>,
);

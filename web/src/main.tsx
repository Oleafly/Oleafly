import "./boot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { createWebApi } from "./api";
import { App } from "./components/App";
import { initializeWebI18n, webI18n } from "./i18n";
import "./styles.css";

const api = createWebApi();
const container = document.getElementById("root");

function render(): void {
  if (!container) return;
  createRoot(container).render(
    <StrictMode>
      <I18nextProvider i18n={webI18n}>
        <App api={api} />
      </I18nextProvider>
    </StrictMode>,
  );
}

void initializeWebI18n().then(render, render);

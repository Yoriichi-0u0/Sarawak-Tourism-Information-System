import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/lora/latin-400.css";
import "@fontsource/lora/latin-500.css";
import "@fontsource/lora/latin-400-italic.css";
import App from "./App";
import "./styles.css";

const Experience = import.meta.env.MODE === "as03"
  ? lazy(() => import("./as03/Experience"))
  : App;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<p role="status">Opening Sarawak…</p>}>
      <Experience />
    </Suspense>
  </React.StrictMode>,
);

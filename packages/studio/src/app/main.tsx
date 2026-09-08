import { createRoot } from "react-dom/client";
import { App } from "./App";
import { studioClient } from "./use-studio";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root tidak ditemukan");

void studioClient.start();
createRoot(container).render(<App />);

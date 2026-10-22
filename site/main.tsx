import { createRoot } from "react-dom/client";
import { VibeExplorer } from "@/components/vibe-explorer";
import "@/styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<VibeExplorer />);

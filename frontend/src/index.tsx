import React from "react";
import { createRoot } from "react-dom/client";
import RoomSetupWizard from "./components/RoomSetupWizard";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<RoomSetupWizard />);
}

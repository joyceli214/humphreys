import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import { AuthProvider } from "@/lib/auth/auth-context";
import { AlertsProvider } from "@/lib/alerts/alert-context";
import "@/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AlertsProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AlertsProvider>
    </BrowserRouter>
  </React.StrictMode>
);

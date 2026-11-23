"use client"

import { Suspense } from "react";
import "./labelchat.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import RequireFeature from "../components/RequireFeature";
import { LabelChatWorkspace } from "./components/LabelChatWorkspace";

const SearchPage = () => (
  <RequireFeature feature="Label Copilot" featureKey="labelchat" activeApp="afl">
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header />
      <Suspense
        fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            Loading Label Copilot...
          </div>
        }
      >
        <LabelChatWorkspace />
      </Suspense>
      <Footer />
    </div>
  </RequireFeature>
);

export default SearchPage;

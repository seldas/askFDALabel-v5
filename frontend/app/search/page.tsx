"use client"
import { useState, Suspense } from "react";
import "./search_global.css";
import Header from "../components/Header";
import Footer from '../components/Footer';

import ChatPanel from "./components/ChatPanel";
import Results from "./components/Results";
import { SearchProvider } from "./context/SearchContext";

const App = () => {
  const [hasSearched, setHasSearched] = useState(false);
  
  return (
    <SearchProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Header/>
        <div className="app-container" style={{ flex: 1, height: 'auto' }}>
          <div className="chat-column">
             <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading search...</div>}>
                <ChatPanel onSearch={() => setHasSearched(true)} />
             </Suspense>
          </div>
          <div className="results-column">
             <Results hasSearched={hasSearched} />
          </div>
        </div>
        <Footer/>
      </div>
    </SearchProvider>
  );
};

export default App;

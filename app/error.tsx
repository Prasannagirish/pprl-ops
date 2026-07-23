"use client";

import { useEffect } from "react";
import { RefreshCcw } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="login-page">
      <div className="login-page-toggle">
        <ThemeToggle />
      </div>

      <section className="panel login-panel">
        <div className="panel-body">
          <div className="brand">
            <span className="brand-mark">PPRL</span>
            <div>
              <h1>Something went wrong</h1>
              <p>The page hit an unexpected error loading its data.</p>
            </div>
          </div>
          <div className="grid">
            <div className="error">{error.message || "An unexpected error occurred."}</div>
            <button className="button primary" onClick={reset} type="button">
              <RefreshCcw size={16} />
              Try again
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

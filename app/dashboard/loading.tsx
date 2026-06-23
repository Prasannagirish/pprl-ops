import type { CSSProperties } from "react";

/**
 * Next.js renders this immediately on navigation to /dashboard, before
 * page.tsx's async work (auth check, then trips + teams fetch) resolves.
 * Without this file, the browser shows nothing at all for however long
 * that round trip takes -- which is where most of the "visible lag" on
 * login was coming from. This doesn't make the backend faster; it just
 * gives the user something to look at immediately, the same way most
 * fast-feeling apps (including Google's own sign-in flow) show a shell
 * or spinner rather than a blank page while the real data loads.
 *
 * Shaped to match the real dashboard (5 metric cards, a toolbar, a table)
 * rather than one flat gray block, with a staggered shimmer so it reads
 * as a sweep across the screen instead of every block pulsing in unison.
 */
const METRIC_COUNT = 5;
const ROW_COUNT = 7;

function delay(index: number, step = 0.07): CSSProperties {
  return { "--shimmer-delay": `${index * step}s` } as CSSProperties;
}

export default function DashboardLoading() {
  return (
    <main className="shell">
      <div className="skeleton-topbar">
        <div className="skeleton-block" style={{ width: 46, height: 34, ...delay(0) }} />
        <div className="skeleton-block" style={{ width: 140, height: 16, ...delay(1) }} />
      </div>
      <div className="page">
        <div className="skeleton-cards">
          {Array.from({ length: METRIC_COUNT }).map((_, i) => (
            <div key={i} className="skeleton-block" style={{ height: 86, ...delay(i, 0.08) }} />
          ))}
        </div>

        <div className="skeleton-block" style={{ height: 44, marginBottom: 18, ...delay(0) }} />

        <div className="panel" style={{ padding: "4px 18px" }}>
          <div className="skeleton-row" style={{ borderBottom: "1px solid var(--line)" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-block" style={{ height: 10, opacity: 0.6, ...delay(i, 0.05) }} />
            ))}
          </div>
          {Array.from({ length: ROW_COUNT }).map((_, rowIndex) => (
            <div key={rowIndex} className="skeleton-row">
              {Array.from({ length: 6 }).map((_, colIndex) => (
                <div
                  key={colIndex}
                  className="skeleton-block"
                  style={delay(rowIndex + colIndex, 0.04)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

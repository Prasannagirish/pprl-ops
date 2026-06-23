/**
 * Next.js renders this immediately on navigation to /dashboard, before
 * page.tsx's async work (auth check, then trips + teams fetch) resolves.
 * Without this file, the browser shows nothing at all for however long
 * that round trip takes -- which is where most of the "visible lag" on
 * login was coming from. This doesn't make the backend faster; it just
 * gives the user something to look at immediately, the same way most
 * fast-feeling apps (including Google's own sign-in flow) show a shell
 * or spinner rather than a blank page while the real data loads.
 */
export default function DashboardLoading() {
  return (
    <main className="shell">
      <div className="skeleton-topbar">
        <div className="skeleton-block" style={{ width: 46, height: 34 }} />
        <div className="skeleton-block" style={{ width: 140, height: 16 }} />
      </div>
      <div className="page">
        <div className="skeleton-cards">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-block" style={{ height: 86 }} />
          ))}
        </div>
        <div className="skeleton-block" style={{ height: 44, marginBottom: 16 }} />
        <div className="skeleton-block" style={{ height: 420 }} />
      </div>
    </main>
  );
}

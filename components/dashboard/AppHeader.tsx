import Link from "next/link";
import { Shield, Users, LogOut } from "lucide-react";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import type { Profile } from "@/types/trip";

export function AppHeader({ profile, pocLabel }: { profile: Profile; pocLabel?: string }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">PPRL</span>
        <div>
          <h1>PPRL Ops</h1>
          <p>{profile.role === "admin" ? "Admin console" : "Team console"}</p>
        </div>
      </div>
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {pocLabel && (
          <span className="poc-badge">👤 {pocLabel}</span>
        )}
        {profile.role === "admin" ? (
          <Link className="button" href="/admin">
            <Shield size={14} />
            Admin
          </Link>
        ) : null}
        <Link className="button" href="/dashboard">
          <Users size={14} />
          Trips
        </Link>
        <LogoutButton />
      </nav>
    </header>
  );
}

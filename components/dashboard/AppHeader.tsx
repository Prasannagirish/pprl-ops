import Link from "next/link";
import { Shield, Users, LogOut, UserRound } from "lucide-react";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
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
      <nav>
        {pocLabel && (
          <span className="poc-badge">
            <UserRound size={13} />
            {pocLabel}
          </span>
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
        <ThemeToggle />
      </nav>
    </header>
  );
}

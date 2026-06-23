import DashboardLoading from "@/app/dashboard/loading";

/**
 * Admin's page shell is the same as the team dashboard's, so reuse the
 * same skeleton rather than maintaining two near-identical ones.
 */
export default function AdminLoading() {
  return <DashboardLoading />;
}

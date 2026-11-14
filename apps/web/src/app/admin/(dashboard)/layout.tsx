import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { LogoutButton } from "@/components/admin/LogoutButton";
import { NewBookingAnnouncer } from "@/components/admin/NewBookingAnnouncer";
import { SessionKeeper } from "@/components/admin/SessionKeeper";
import { getAdminSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  return (
    <div className="min-h-screen bg-[#f5efeb]">
      <header className="border-b border-line bg-cream">
        <div className="container-page flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-display text-lg tracking-tight">
              CakeFlow
            </Link>
            <AdminNav />
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold">{session.name}</p>
              <p className="text-[11px] text-muted">{session.role.toLowerCase()}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="container-page py-8">{children}</main>
      <NewBookingAnnouncer timezone="Australia/Melbourne" />
      <SessionKeeper />
    </div>
  );
}

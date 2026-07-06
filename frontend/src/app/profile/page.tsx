import AppShell from "@/components/layout/AppShell";
import ProfileShell from "@/components/profile/ProfileShell";

/**
 * Profile 管理页面 (/profile)。
 * Server Component - 将 ProfileShell 客户端组件包裹在 AppShell 布局中。
 */
export default function ProfilePage() {
  return (
    <AppShell>
      <ProfileShell />
    </AppShell>
  );
}

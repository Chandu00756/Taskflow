import { NotificationsList } from '@/components/desk/notifications-list';

export default function PortalNotificationsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Notifications</h1>
      <NotificationsList portal />
    </div>
  );
}

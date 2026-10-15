import { redirect } from 'next/navigation';

// Tasks now live in project work items (boards, lists, cycles).
export default function LegacyTasksPage() {
  redirect('/projects');
}

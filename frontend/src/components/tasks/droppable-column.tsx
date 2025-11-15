import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskStatus } from '@/lib/api/types';
import type { Task } from '@/lib/api/types';

interface DroppableColumnProps {
  id: TaskStatus;
  title: string;
  color: string;
  tasks: Task[];
  loading: boolean;
  children: React.ReactNode;
}

export function DroppableColumn({ id, title, color, tasks, loading, children }: DroppableColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: id,
  });

  return (
    <SortableContext
      id={id}
      items={tasks.map((t) => t.id)}
      strategy={verticalListSortingStrategy}
    >
      <div ref={setNodeRef}>
        <Card className={`border border-white/60 bg-gradient-to-br ${color} p-4 shadow-xl transition-all ${isOver ? 'ring-2 ring-blue-400 scale-[1.02]' : ''}`}>
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-bold text-slate-900">
                {title}
              </CardTitle>
              <Badge variant="secondary" className="rounded-full">
                {tasks.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-0 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-3xl" />
              ))
            ) : tasks.length === 0 ? (
              <div className={`rounded-3xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500 transition-all ${isOver ? 'bg-blue-50 border-blue-300' : ''}`}>
                {isOver ? 'Drop here' : 'No tasks here yet'}
              </div>
            ) : (
              children
            )}
          </CardContent>
        </Card>
      </div>
    </SortableContext>
  );
}

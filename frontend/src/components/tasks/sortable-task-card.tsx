import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { Calendar, Flag, Trash2, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { Task, TaskPriority } from '@/lib/api/types';

const PRIORITY_CONFIG: Record<TaskPriority, { color: string; label: string }> = {
  [TaskPriority.LOW]: { color: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Low' },
  [TaskPriority.MEDIUM]: { color: 'bg-sky-100 text-sky-700 border-sky-200', label: 'Medium' },
  [TaskPriority.HIGH]: { color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'High' },
  [TaskPriority.CRITICAL]: { color: 'bg-rose-100 text-rose-700 border-rose-200', label: 'Critical' },
};

interface SortableTaskCardProps {
  task: Task;
  onDelete: () => void;
  onOpen?: () => void;
}

export function SortableTaskCard({ task, onDelete, onOpen }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priorityConfig = PRIORITY_CONFIG[task.priority];

  return (
    <div ref={setNodeRef} style={style}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="group relative rounded-3xl border border-white/80 bg-white/90 p-4 shadow-md transition hover:shadow-xl"
      >
        <div className="flex items-start gap-3">
          <button
            {...attributes}
            {...listeners}
            className="mt-1 cursor-grab text-slate-400 transition hover:text-slate-600 active:cursor-grabbing"
            aria-label="Drag to move task"
          >
            <GripVertical className="h-5 w-5" />
          </button>
          
          <div 
            className="flex-1 space-y-3 cursor-pointer" 
            onClick={() => onOpen?.()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen?.();
              }
            }}
          >
            <div>
              <h3 className="font-semibold text-slate-900">{task.title}</h3>
              {task.description && (
                <p className="mt-1 text-sm text-slate-600 line-clamp-2">
                  {task.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`rounded-full border ${priorityConfig.color}`}>
                <Flag className="mr-1 h-3 w-3" />
                {priorityConfig.label}
              </Badge>
              
              {task.due_date && (
                <Badge variant="outline" className="rounded-full">
                  <Calendar className="mr-1 h-3 w-3" />
                  {formatDate(task.due_date)}
                </Badge>
              )}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="opacity-0 transition group-hover:opacity-100"
            aria-label="Delete task"
          >
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

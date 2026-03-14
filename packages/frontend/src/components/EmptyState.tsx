import type { ReactNode } from 'react';

export function EmptyState({ icon = '◆', title, description, action }: { icon?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <div className="empty-state__title">{title}</div>
      <div className="empty-state__desc">{description}</div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

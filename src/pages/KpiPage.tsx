import { EmptyState } from '@/components/EmptyState';

export function KpiPage() {
  return (
    <div className="card">
      <h2 className="card-title">KPI задачи</h2>
      <EmptyState title="Раздел «KPI задачи» в разработке" description="Здесь будет отображаться информация по KPI задачам." />
    </div>
  );
}


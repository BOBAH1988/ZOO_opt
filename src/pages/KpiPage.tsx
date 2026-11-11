import { EmptyState } from '@/components/EmptyState';

export function KpiPage() {
  return (
    <div className="card">
      <h2 className="card-title">KPI</h2>
      <EmptyState title="Раздел KPI в разработке" description="Здесь будет отображаться информация по KPI." />
    </div>
  );
}


import { EmptyState } from '@/components/EmptyState';

export function ReportsPage() {
  return (
    <div className="card">
      <h2 className="card-title">Отчёты</h2>
      <EmptyState
        title="Отчётов пока нет"
        description="Здесь будут отображаться результаты запущенных процессов автоматизации почты. В MVP отчёты не формируются."
      />
    </div>
  );
}
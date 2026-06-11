import { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-border rounded-2xl p-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-[0.1em] text-secondary mb-2">
      {children}
    </h3>
  );
}

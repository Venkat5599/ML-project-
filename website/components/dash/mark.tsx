export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7.6" stroke="currentColor" strokeWidth="2.6" />
      <path d="M6.6 12.4 L10 6.9 L13.6 11.6 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="6.6" cy="12.4" r="1.75" fill="currentColor" />
      <circle cx="10" cy="6.9" r="1.75" fill="currentColor" />
      <circle cx="13.6" cy="11.6" r="1.75" fill="currentColor" />
      <path d="M15.6 15.6 L21.6 21.6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

interface ReviewEmptyStateProps {
  title: string;
  description: string;
  icon?: 'upload' | 'error' | 'empty';
}

export function ReviewEmptyState({ title, description, icon = 'empty' }: ReviewEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full p-8">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full bg-stone-100">
          {icon === 'upload' && (
            <svg className="w-8 h-8 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          )}
          {icon === 'error' && (
            <svg className="w-8 h-8 text-cinnabar" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
          {icon === 'empty' && (
            <svg className="w-8 h-8 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
        </div>
        <h3 className="font-song text-base font-bold text-stone-700 mb-2">{title}</h3>
        <p className="text-sm text-stone-500 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

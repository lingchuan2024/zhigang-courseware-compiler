import { type ReactNode, useEffect, useRef, useState } from 'react';

interface RevealSectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function RevealSection({ children, className = '', id }: RevealSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (!element || revealed) return;
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setRevealed(true);
      observer.disconnect();
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <section
      ref={ref}
      id={id}
      data-revealed={revealed}
      className={`${className} transition duration-700 ease-out motion-reduce:transform-none motion-reduce:transition-none ${revealed ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
    >
      {children}
    </section>
  );
}

"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-surface-canvas px-6 text-center">
      <h1 className="text-title-lg text-primary">This surface stopped early</h1>
      <p className="mt-1.5 max-w-[52ch] text-ui-sm text-secondary">
        {error.message || "Something in the page failed to render."}
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 items-center rounded-md bg-accent-solid px-3 text-ui font-medium text-white transition-colors duration-100 hover:bg-accent-solid-hover"
        >
          Retry
        </button>
        <Link
          href="/ask"
          className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-ui font-medium text-primary transition-colors duration-100 hover:bg-overlay-hover"
        >
          Back to Ask
        </Link>
      </div>
    </div>
  );
}

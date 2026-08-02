import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-surface-canvas px-6 text-center">
      <p className="text-label text-tertiary uppercase">404</p>
      <h1 className="mt-2 text-title-lg text-primary">This page doesn&apos;t exist</h1>
      <p className="mt-1.5 max-w-[46ch] text-ui-sm text-secondary">
        The link may be stale, or the object it pointed at was deleted.
      </p>
      <Link
        href="/ask"
        className="mt-5 inline-flex h-8 items-center rounded-md bg-accent-solid px-3 text-ui font-medium text-white transition-colors duration-100 hover:bg-accent-solid-hover"
      >
        Ask a question
      </Link>
    </div>
  );
}

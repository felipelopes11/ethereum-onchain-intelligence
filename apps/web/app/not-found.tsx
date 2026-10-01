import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-ink-2">
        <Link href="/" className="text-accent-ink hover:underline">
          Search for an address or transaction
        </Link>
      </p>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { parseSearchQuery } from '@eoi/shared';
import { api, ApiRequestError } from '@/lib/api';

export function searchDestination(
  input: string,
): { href: string } | { ens: string } | { error: string } {
  const parsed = parseSearchQuery(input);
  if (!parsed.ok) return { error: parsed.error };
  const { target } = parsed;
  if (target.type === 'address') return { href: `/address/${target.value}` };
  if (target.type === 'transaction') return { href: `/tx/${target.value}` };
  return { ens: target.value };
}

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    const destination = searchDestination(value);
    if ('error' in destination) {
      setError(destination.error);
      return;
    }
    setError(null);
    if ('href' in destination) {
      router.push(destination.href);
      return;
    }
    setPending(true);
    try {
      const result = await api.search(destination.ens);
      if (result.type === 'address') router.push(`/address/${result.address}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'ENS lookup failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="w-full" role="search">
      <label htmlFor={inputId} className="sr-only">
        Search Ethereum address or transaction hash
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          maxLength={256}
          placeholder="Search Ethereum address or transaction hash"
          aria-invalid={error !== null}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Resolving…' : 'Analyze'}
        </button>
      </div>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      )}
    </form>
  );
}

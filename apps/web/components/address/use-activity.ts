'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Shared by several tabs; TanStack Query dedupes the request across them. */
export function useActivity(address: string) {
  return useQuery({
    queryKey: ['activity', address],
    queryFn: ({ signal }) => api.activity(address, signal),
  });
}

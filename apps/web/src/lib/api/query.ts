import { QueryClient, useMutation, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { ApiError, backend, unwrap } from "../backend";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

/** Reads through an RPC. The key starts with the function name so mutations can invalidate by domain. */
export function useRpc<T>(fn: string, args: Record<string, unknown> | null, opts: Partial<UseQueryOptions<T, ApiError>> = {}) {
  return useQuery<T, ApiError>({
    queryKey: ["rpc", fn, args],
    queryFn: () => backend.rpc<T>(fn, args ?? {}),
    enabled: args !== null && (opts.enabled ?? true),
    ...opts,
  });
}

/** Writes through an RPC; results with { ok: false } become errors; all RPC reads are refreshed afterwards. */
export function useRpcMutation<TArgs extends Record<string, unknown>, T = unknown>(
  fn: string,
  opts: { onSuccess?: (data: T, args: TArgs) => void; raw?: boolean } = {},
) {
  return useMutation<T, ApiError, TArgs>({
    mutationFn: async (args) => {
      const r = await backend.rpc<T>(fn, args);
      return opts.raw ? r : unwrap(r);
    },
    onSuccess: async (data, args) => {
      await queryClient.invalidateQueries({ queryKey: ["rpc"] });
      opts.onSuccess?.(data, args);
    },
  });
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return unwrap(await backend.rpc<T>(fn, args));
}

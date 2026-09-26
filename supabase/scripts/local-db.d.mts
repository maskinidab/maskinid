export function targetUrl(): string;
export function migrationFiles(): string[];
export function applySql(client: any, sql: any, label: any): Promise<void>;
export function reset({ seed, fixtures, quiet }?: {
    seed?: boolean | undefined;
    fixtures?: boolean | undefined;
    quiet?: boolean | undefined;
}): Promise<string>;
export const DEFAULT_URL: "postgres://postgres:postgres@127.0.0.1:54322/postgres";

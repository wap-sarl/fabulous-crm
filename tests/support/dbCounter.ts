/** What a call did to the database: documents read and writes made, per table. */
export type DbCount = { reads: Record<string, number>; writes: Record<string, number> };

type Syscalls = {
  syscall: (op: string, args: string) => string;
  asyncSyscall: (op: string, args: string) => Promise<string>;
  jsSyscall: unknown;
};

const WRITES = new Set(['1.0/insert', '1.0/shallowMerge', '1.0/replace', '1.0/remove']);

/** The table a query reads, from the source convex hands to the backend. */
function tableOfQuery(query: { source?: { tableName?: string; indexName?: string } }): string {
  return query.source?.tableName ?? query.source?.indexName?.split('.')[0] ?? '?';
}

/** Counts the documents every function reads and the writes it makes while `run` runs, by listening to the calls convex-test answers. */
export async function countDb(run: () => Promise<unknown>): Promise<DbCount> {
  const count: DbCount = { reads: {}, writes: {} };
  const bump = (kind: keyof DbCount, table: string) => {
    count[kind][table] = (count[kind][table] ?? 0) + 1;
  };
  const holder = globalThis as unknown as { Convex: Syscalls };
  const real = holder.Convex;
  const tableOfStream = new Map<number, string>();
  holder.Convex = {
    get syscall() {
      return (op: string, json: string) => {
        const out = real.syscall(op, json);
        if (op === '1.0/queryStream') {
          tableOfStream.set(JSON.parse(out).queryId, tableOfQuery(JSON.parse(json).query));
        }
        return out;
      };
    },
    get asyncSyscall() {
      return async (op: string, json: string) => {
        const out = await real.asyncSyscall(op, json);
        const args = JSON.parse(json);
        // An id of convex-test ends with the name of its table.
        if (op === '1.0/get' && JSON.parse(out) !== null) {
          bump('reads', args.table ?? String(args.id).replace(/^\d+/, ''));
        }
        if (op === '1.0/queryStreamNext' && !JSON.parse(out).done) {
          bump('reads', tableOfStream.get(args.queryId) ?? '?');
        }
        if (op === '1.0/queryPage') {
          for (const _doc of JSON.parse(out).page) bump('reads', tableOfQuery(args.query));
        }
        if (WRITES.has(op)) bump('writes', args.table ?? String(args.id).replace(/^\d+/, ''));
        return out;
      };
    },
    get jsSyscall() {
      return real.jsSyscall;
    },
  };
  try {
    await run();
  } finally {
    holder.Convex = real;
  }
  return count;
}

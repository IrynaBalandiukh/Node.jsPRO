import { BadRequestError } from './errors';

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64');
}

export function decodeCursor(cursor: string): number {
  try {
    const { offset } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof offset !== 'number' || offset < 0) throw new Error('bad offset');
    return offset;
  } catch {
    throw new BadRequestError(`'cursor' is not a valid opaque pagination token`);
  }
}

export function paginate<T>(
  collection: T[],
  { limit = 20, cursor }: { limit?: number; cursor?: string } = {},
): Page<T> {
  const offset = cursor ? decodeCursor(cursor) : 0;
  const page = collection.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const next_cursor = nextOffset < collection.length ? encodeCursor(nextOffset) : null;
  return { items: page, next_cursor };
}

const { BadRequestError } = require('./errors');

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  try {
    const { offset } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof offset !== 'number' || offset < 0) throw new Error('bad offset');
    return offset;
  } catch {
    throw new BadRequestError(`'cursor' is not a valid opaque pagination token`);
  }
}

function paginate(collection, { limit = 20, cursor } = {}) {
  const offset = cursor ? decodeCursor(cursor) : 0;
  const page = collection.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const next_cursor = nextOffset < collection.length ? encodeCursor(nextOffset) : null;
  return { items: page, next_cursor };
}

module.exports = { paginate, encodeCursor, decodeCursor };

import { PG_CHECK_VIOLATION, PG_UNIQUE_VIOLATION } from '../../src/repositories/queryable';
import { UsersRepository } from '../../src/repositories/users.repository';
import { aUser } from './testkit/builders';
import { startTestDb, TestDb } from './testkit/postgres';

describe('UsersRepository (real Postgres)', () => {
  let db: TestDb;
  let users: UsersRepository;

  beforeAll(async () => {
    db = await startTestDb();
    users = new UsersRepository(db.pool);
  });
  afterAll(async () => {
    await db.stop();
  });
  beforeEach(async () => {
    await db.reset();
  });

  it('creates a user and finds it by email', async () => {
    const created = await users.create(aUser({ role: 'seller' }));
    const found = await users.findByEmail(created.email);

    expect(found).toEqual(created);
    expect(found).toMatchObject({ role: 'seller', balanceCents: 0 });
  });

  it('rejects a duplicate email with a unique violation (23505)', async () => {
    const user = aUser();
    await users.create(user);

    await expect(users.create(user)).rejects.toMatchObject({
      code: PG_UNIQUE_VIOLATION,
      constraint: expect.stringMatching(/email|UQ_/i),
    });
  });

  it('rejects a role outside the CHECK constraint (23514)', async () => {
    await expect(users.create(aUser({ role: 'hacker' as never }))).rejects.toMatchObject({
      code: PG_CHECK_VIOLATION,
    });
  });

  it('ensure() is idempotent: ON CONFLICT returns the same row, no duplicate', async () => {
    const user = aUser();
    const first = await users.ensure(user);
    const second = await users.ensure(user);

    expect(second.id).toBe(first.id);
    expect(await users.count()).toBe(1);
  });
});

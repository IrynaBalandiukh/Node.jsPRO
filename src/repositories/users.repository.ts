import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Queryable } from './queryable';

export type UserRole = 'buyer' | 'seller' | 'admin';

export interface UserRecord {
  id: string;
  email: string;
  role: UserRole;
  balanceCents: number;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  role: UserRole;
  balanceCents?: number;
}

const COLUMNS = `id::text AS id, email, role, balance_cents`;

function map(row: any): UserRecord {
  return { id: row.id, email: row.email, role: row.role, balanceCents: row.balance_cents };
}

export class UsersRepository {
  constructor(private readonly db: Queryable) {}

  async create(user: NewUser): Promise<UserRecord> {
    const { rows } = await this.db.query(
      `INSERT INTO users (email, password_hash, role, balance_cents)
       VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [user.email, user.passwordHash, user.role, user.balanceCents ?? 0],
    );
    return map(rows[0]);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM users WHERE email = $1`, [email]);
    return rows[0] ? map(rows[0]) : null;
  }

  /**
   * Idempotent INSERT ... ON CONFLICT: a repeated call with the same email
   * doesn't fail on UNIQUE and doesn't create a duplicate, but returns the existing row.
   * (DO UPDATE instead of DO NOTHING — so RETURNING returns a row in both branches.)
   */
  async ensure(user: NewUser): Promise<UserRecord> {
    const { rows } = await this.db.query(
      `INSERT INTO users (email, password_hash, role, balance_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lower(email)) DO UPDATE SET email = users.email
       RETURNING ${COLUMNS}`,
      [user.email, user.passwordHash, user.role, user.balanceCents ?? 0],
    );
    return map(rows[0]);
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query(`SELECT count(*)::int AS n FROM users`);
    return rows[0].n;
  }
}

@Injectable()
export class NestUsersRepository extends UsersRepository {
  constructor(database: DatabaseService) {
    super(database.pool);
  }
}

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
   * Ідемпотентний INSERT ... ON CONFLICT: повторний виклик з тим самим email
   * не падає на UNIQUE і не створює дубль, а повертає наявний рядок.
   * (DO UPDATE замість DO NOTHING — щоб RETURNING повертав рядок в обох гілках.)
   */
  async ensure(user: NewUser): Promise<UserRecord> {
    const { rows } = await this.db.query(
      `INSERT INTO users (email, password_hash, role, balance_cents)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
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

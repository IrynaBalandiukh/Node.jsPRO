import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, Check } from 'typeorm';

export type JobStatus = 'pending' | 'done';

// Task queue. Workers pick rows with SELECT ... FOR UPDATE SKIP LOCKED;
// `processed` counts executions and proves each job ran exactly once.
// Constraint and index names match the migration ConcurrencyLayer1790200000000.
@Entity({ name: 'jobs' })
@Check('CHK_jobs_status', `"status" IN ('pending', 'done')`)
@Check('CHK_jobs_processed', `"processed" >= 0`)
// Partial index: only pending jobs are indexed. The where text matches how
// Postgres stores it, so the schema check sees no difference.
@Index('idx_jobs_pending', ['id'], { where: `(status = 'pending'::text)` })
export class Job {
  // bigint arrives from the driver as a string.
  @PrimaryGeneratedColumn({ type: 'bigint', primaryKeyConstraintName: 'PK_jobs_id' })
  id!: string;

  @Column({ type: 'text' })
  kind!: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  payload!: Record<string, unknown>;

  @Column({ type: 'text', default: 'pending' })
  status!: JobStatus;

  @Column({ type: 'integer', default: 0 })
  processed!: number;

  @Column({ name: 'worker_id', type: 'text', nullable: true })
  workerId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}

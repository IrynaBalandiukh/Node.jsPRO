import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, Check } from 'typeorm';

export type JobStatus = 'pending' | 'done';

// Черга задач (ДЗ №14). Воркери беруть рядки через
// SELECT ... FOR UPDATE SKIP LOCKED; `processed` — лічильник виконань, який
// доводить, що кожна задача оброблена рівно один раз.
@Entity({ name: 'jobs' })
@Check(`"status" IN ('pending', 'done')`)
@Check(`"processed" >= 0`)
@Index('idx_jobs_pending', ['id'], { where: `"status" = 'pending'` })
export class Job {
  @PrimaryGeneratedColumn({ type: 'bigint' })
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

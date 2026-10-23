export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

const PROBLEM_BASE = 'https://marketplace.example/problems';

// 422 is only raised for an Idempotency-Key reused with a different body,
// so it maps to a dedicated type; 400 is a validation / malformed request.
export const PROBLEM_TYPES: Record<number, string> = {
  400: `${PROBLEM_BASE}/validation-error`,
  404: `${PROBLEM_BASE}/not-found`,
  422: `${PROBLEM_BASE}/idempotency-key-conflict`,
  500: `${PROBLEM_BASE}/internal-error`,
};

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

export function buildProblem(status: number, detail: string, instance: string): ProblemBody {
  return {
    type: PROBLEM_TYPES[status] || 'about:blank',
    title: STATUS_TITLES[status] || 'Error',
    status,
    detail: detail || 'Unexpected error',
    instance,
  };
}

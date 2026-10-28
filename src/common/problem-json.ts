export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

const PROBLEM_BASE = 'https://marketplace.example/problems';

// 409 covers two situations, told apart by PROBLEM_URIS below. 422 is only raised for an Idempotency-Key reused with a different body,
// so it maps to a dedicated type; 400 is a validation / malformed request.
export const PROBLEM_TYPES: Record<number, string> = {
  400: `${PROBLEM_BASE}/validation-error`,
  404: `${PROBLEM_BASE}/not-found`,
  409: `${PROBLEM_BASE}/conflict`,
  422: `${PROBLEM_BASE}/idempotency-key-conflict`,
  500: `${PROBLEM_BASE}/internal-error`,
};

// More specific types for errors that share a status code.
export const PROBLEM_URIS = {
  insufficientStock: `${PROBLEM_BASE}/insufficient-stock`,
  invalidStatusTransition: `${PROBLEM_BASE}/invalid-status-transition`,
} as const;

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

export function buildProblem(
  status: number,
  detail: string,
  instance: string,
  type?: string,
): ProblemBody {
  return {
    type: type ?? (PROBLEM_TYPES[status] || 'about:blank'),
    title: STATUS_TITLES[status] || 'Error',
    status,
    detail: detail || 'Unexpected error',
    instance,
  };
}

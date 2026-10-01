export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

export const PROBLEM_TYPES: Record<number, string> = {
  400: 'https://api.example.com/problems/validation-error',
  404: 'https://api.example.com/problems/not-found',
  422: 'https://api.example.com/problems/idempotency-key-conflict',
  500: 'https://api.example.com/problems/internal-error',
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

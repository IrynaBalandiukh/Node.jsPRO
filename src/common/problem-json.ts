export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
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
    type: 'about:blank',
    title: STATUS_TITLES[status] || 'Error',
    status,
    detail: detail || 'Unexpected error',
    instance,
  };
}

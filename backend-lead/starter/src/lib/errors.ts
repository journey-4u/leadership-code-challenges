export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toBody(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...(this.details ?? {}) };
  }
}

export class NotFoundError extends AppError {
  constructor(what: string, id?: string) {
    super(404, 'not_found', id ? `${what} ${id} not found` : `${what} not found`);
  }
}

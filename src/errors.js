class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class BadRequestError extends HttpError {
  constructor(message) {
    super(400, message);
  }
}

class NotFoundError extends HttpError {
  constructor(message) {
    super(404, message);
  }
}

class UnprocessableEntityError extends HttpError {
  constructor(message) {
    super(422, message);
  }
}

module.exports = { HttpError, BadRequestError, NotFoundError, UnprocessableEntityError };

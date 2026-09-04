class PilgrimageError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'PilgrimageError';
    this.code = code;
    this.details = details || null;
  }
}

function isPilgrimageError(error) {
  return !!(error && error.name === 'PilgrimageError' && typeof error.code === 'string');
}

module.exports = { PilgrimageError, isPilgrimageError };

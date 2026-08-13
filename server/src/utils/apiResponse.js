
export const success = (res, data = null, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

export const error = (res, message = 'An error occurred', statusCode = 500, errors = null) => {
  const response = {
    success: false,
    message
  };

  if (errors !== null) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

export const sendSuccess = (res, message, data, statusCode) => success(res, data, message, statusCode);
export const sendError = (res, message, errors, statusCode) => error(res, message, statusCode, errors);

export default {
  success,
  error,
  sendSuccess,
  sendError
};

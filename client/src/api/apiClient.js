import axios from 'axios';

export const apiClient = axios.create({
  baseURL: 'http://localhost:5000/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

let expectedUserId = null;

export const setExpectedUser = (id) => {
  expectedUserId = id ? String(id) : null;
};

export const getExpectedUser = () => expectedUserId;

apiClient.interceptors.request.use((config) => {
  if (expectedUserId) config.headers['X-Skribe-User'] = expectedUserId;
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    const errorResponse = error.response?.data || {
      success: false,
      message: error.message || 'Network error occurred. Please check your connection.'
    };
    return Promise.reject(errorResponse);
  }
);

export default apiClient;

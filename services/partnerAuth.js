import api from './api';
import axios from axios

export const login = async (email, password) => {
  try {
    const response = await axios.post('/partners/login', { email, password });
    localStorage.setItem('token', response.data.token);
    return response.data;
  } catch (error) {
    throw error.response?.data?.error || 'Login failed';
  }
};

export const logout = async () => {
  try {
    await api.post('/partners/logout');
    localStorage.removeItem('token');
  } catch (error) {
    console.error('Logout error:', error);
  }
};

export const getCurrentPartner = async () => {
  try {
    const response = await api.get('/partners/me');
    return response.data;
  } catch (error) {
    throw error.response?.data?.error || 'Failed to fetch partner';
  }
};
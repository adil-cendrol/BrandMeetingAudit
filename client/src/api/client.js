import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

const api = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
});

export const assessmentApi = {
    getAll: () => api.get('/assessments').then(r => r.data.data),
    getById: (id) => api.get(`/assessments/${id}`).then(r => r.data.data),
    create: (formData) => api.post('/assessments', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data),
    startAnalysis: (id) => api.post(`/assessments/${id}/start`).then(r => r.data.data),
    getStatus: (id) => api.get(`/assessments/${id}/status`).then(r => r.data.data),
    exportReport: (id, payload) => api.post(`/assessments/${id}/export`, payload, { responseType: 'blob' }).then(r => r.data),
    delete: (id) => api.delete(`/assessments/${id}`).then(r => r.data),
};

export default api;

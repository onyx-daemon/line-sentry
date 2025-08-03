import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const API_BASE_URL = 'http://localhost:3001/api';

class ApiService {
  private axiosInstance: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('token');
    
    // Create axios instance with security configurations
    this.axiosInstance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      withCredentials: true, // Include cookies for CSRF protection
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest', // CSRF protection
      }
    });

    // Request interceptor to add auth token
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.clearToken();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('token');
  }

  private async request(endpoint: string, options: AxiosRequestConfig = {}) {
    try {
      const response = await this.axiosInstance({
        url: endpoint,
        ...options
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw new Error(error.message || 'Network error');
    }
  }

  // Auth
  async login(username: string, password: string, captchaToken?: string) {
    const response = await this.request('/auth/login', {
      method: 'POST',
      data: { username, password, captchaToken },
    });
    this.setToken(response.token);
    return response;
  }

  async getCurrentOperator() {
    return this.request('/users/me/operator');
  }

  async getCurrentUser() {
    return this.request('/auth/me');
  }

  async initDemo() {
    return this.request('/auth/init-demo', { method: 'POST' });
  }

  // Departments
  async getDepartments() {
    return this.request('/departments');
  }

  async getDepartment(id: string) {
    return this.request(`/departments/${id}`);
  }

  async getDepartmentsAdmin(params?: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: string;
    sortBy?: string;
    sortOrder?: string;
  }) {
    return this.request('/departments/admin/all', {
      method: 'GET',
      params
    });
  }

  async createDepartment(department: any) {
    return this.request('/departments', {
      method: 'POST',
      data: department,
    });
  }

  async updateDepartment(id: string, department: any) {
    return this.request(`/departments/${id}`, {
      method: 'PUT',
      data: department,
    });
  }

  async getAllDepartments() {
    return this.request('/departments/admin/all');
  }

  async deleteDepartment(id: string) {
    return this.request(`/departments/${id}`, {
      method: 'DELETE',
    });
  }

  async getDepartmentStats(departmentId: string) {
    return this.request(`/analytics/department-stats/${departmentId}`);
  }

  // Machines
  async getMachinesByDepartment(departmentId: string) {
    return this.request(`/machines/department/${departmentId}`);
  }

  async getMachine(id: string) {
    return this.request(`/machines/${id}`);
  }

  async getMachines() {
    return this.request('/machines');
  }

  async createMachine(machine: any) {
    return this.request('/machines', {
      method: 'POST',
      data: machine,
    });
  }

  async updateMachine(id: string, machineData: any) {
    return this.request(`/machines/${id}`, {
      method: 'PUT',
      data: machineData,
    });
  }

  async updateMachinePosition(
    id: string, 
    position: { x: number; y: number }, 
    dimensions: { width: number; height: number }
  ) {
    return this.request(`/machines/${id}/position`, {
      method: 'PATCH',
      data: { 
        x: position.x, 
        y: position.y,
        width: dimensions.width,
        height: dimensions.height
      },
    });
  }

  async deleteMachine(id: string) {
    return this.request(`/machines/${id}`, {
      method: 'DELETE',
    });
  }

  // Users
  async getUsers() {
    return this.request('/users');
  }
  
  async getUsersAdmin(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    department?: string;
    isActive?: string;
    sortBy?: string;
    sortOrder?: string;
  }) {
    return this.request('/users/admin/all', {
      method: 'GET',
      params
    });
  }

  async createUser(user: any) {
    return this.request('/users', {
      method: 'POST',
      data: user,
    });
  }

  async updateUser(id: string, user: any) {
    return this.request(`/users/${id}`, {
      method: 'PUT',
      data: user,
    });
  }

  async deleteUser(id: string) {
    return this.request(`/users/${id}`, {
      method: 'DELETE',
    });
  }

  // Analytics
  async getProductionTimeline(machineId: string) {
    return this.request(`/analytics/production-timeline/${machineId}`);
  }

  async getMachineStats(machineId: string, period: string = '24h') {
    return this.request(`/analytics/machine-stats/${machineId}`, {
      params: { period }
    });
  }

  async addStoppageRecord(stoppage: any) {
    return this.request('/analytics/stoppage', {
      method: 'POST',
      data: stoppage,
    });
  }

  async updateStoppageRecord(id: string, stoppage: any) {
    return this.request(`/analytics/stoppage/${id}`, {
      method: 'PUT',
      data: stoppage,
    });
  }

  async updateProductionAssignment(data: any) {
    return this.request('/analytics/production-assignment', {
      method: 'POST',
      data: data,
    });
  }

  // Configuration
  async getConfig() {
    return this.request('/config');
  }

  async getShifts() {
    return this.request('/config/shifts');
  }

  async updateConfig(config: any) {
    return this.request('/config', {
      method: 'PUT',
      data: config,
    });
  }

  // Sensors
  async getSensors() {
    return this.request('/sensors');
  }

  async getSensorsByMachine(machineId: string) {
    return this.request(`/sensors/machine/${machineId}`);
  }

  async getSensorsAdmin(params?: {
    page?: number;
    limit?: number;
    search?: string;
    department?: string;
    status?: string;
    sensorType?: string;
    sortBy?: string;
    sortOrder?: string;
  }) {
    return this.request('/sensors/admin/all', {
      method: 'GET',
      params
    });
  }

  async createSensor(sensor: any) {
    return this.request('/sensors', {
      method: 'POST',
      data: sensor,
    });
  }

  async updateSensor(id: string, sensorData: any) {
    return this.request(`/sensors/${id}`, {
      method: 'PUT',
      data: sensorData,
    });
  }

  async deleteSensor(id: string) {
    return this.request(`/sensors/${id}`, {
      method: 'DELETE',
    });
  }

  // Pin mapping
  async deletePinMapping(id: string) {
    return this.request(`/sensors/pin-mapping/${id}`, {
      method: 'DELETE',
    });
  }

  async createPinMapping(mapping: any) {
    return this.request('/sensors/pin-mapping', {
      method: 'POST',
      data: mapping,
    });
  }

  async getPinMappings() {
    return this.request('/sensors/pin-mappings');
  }

  // Molds
  async getMolds() {
    return this.request('/molds');
  }

  async getMoldsAdmin(params?: {
    page?: number;
    limit?: number;
    search?: string;
    department?: string;
    isActive?: string;
    sortBy?: string;
    sortOrder?: string;
  }) {
    return this.request('/molds/admin/all', {
      method: 'GET',
      params
    });
  }

  async createMold(mold: any) {
    return this.request('/molds', {
      method: 'POST',
      data: mold,
    });
  }

  async updateMold(id: string, moldData: any) {
    return this.request(`/molds/${id}`, {
      method: 'PUT',
      data: moldData,
    });
  }

  async deleteMold(id: string) {
    return this.request(`/molds/${id}`, {
      method: 'DELETE',
    });
  }

  async toggleMoldStatus(id: string) {
    return this.request(`/molds/${id}/status`, {
      method: 'PATCH',
    });
  }

  // Reports
  async getReports(filters?: any) {
    return this.request('/reports', {
      method: 'GET',
      params: filters
    });
  }

  async generateReport(reportData: any) {
    return this.request('/reports/generate', {
      method: 'POST',
      data: reportData,
    });
  }

  async emailReport(reportId: string) {
    return this.request(`/reports/${reportId}/email`, {
      method: 'POST',
    });
  }

  // Generic request method for internal use
  async request(endpoint: string, options: AxiosRequestConfig = {}) {
    return this.request(endpoint, options);
  }

  // Download PDF with proper handling
  async downloadReportPDF(reportId: string, reportType: string, startDate: string) {
    try {
      const response = await this.axiosInstance({
        url: `/reports/${reportId}/pdf`,
        method: 'GET',
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${reportType}-report-${startDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      return { success: true };
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to download PDF');
    }
  }
}

export default new ApiService();
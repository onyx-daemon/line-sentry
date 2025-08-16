import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { Department } from '../../types';
import apiService from '../../services/api';

interface DepartmentState {
  departments: Department[];
  currentDepartment: Department | null;
  loading: boolean;
  error: string | null;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalDepartments: number;
    limit: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  } | null;
  filters: {
    search: string;
    isActive: string;
    sortBy: string;
    sortOrder: string;
  };
}

const initialState: DepartmentState = {
  departments: [],
  currentDepartment: null,
  loading: false,
  error: null,
  pagination: null,
  filters: {
    search: '',
    isActive: '',
    sortBy: 'name',
    sortOrder: 'asc',
  },
};

// Async thunks
export const fetchDepartments = createAsyncThunk(
  'departments/fetchDepartments',
  async (limit?: number) => {
    return await apiService.getDepartments(limit);
  }
);

export const fetchDepartmentsAdmin = createAsyncThunk(
  'departments/fetchDepartmentsAdmin',
  async (params: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => {
    return await apiService.getDepartmentsAdmin(params);
  }
);

export const fetchDepartment = createAsyncThunk(
  'departments/fetchDepartment',
  async (id: string) => {
    return await apiService.getDepartment(id);
  }
);

export const createDepartment = createAsyncThunk(
  'departments/createDepartment',
  async (departmentData: Partial<Department>) => {
    return await apiService.createDepartment(departmentData);
  }
);

export const updateDepartment = createAsyncThunk(
  'departments/updateDepartment',
  async ({ id, data }: { id: string; data: Partial<Department> }) => {
    return await apiService.updateDepartment(id, data);
  }
);

export const deleteDepartment = createAsyncThunk(
  'departments/deleteDepartment',
  async (id: string) => {
    await apiService.deleteDepartment(id);
    return id;
  }
);

export const fetchDepartmentStats = createAsyncThunk(
  'departments/fetchDepartmentStats',
  async (departmentId: string) => {
    const stats = await apiService.getDepartmentStats(departmentId);
    return { departmentId, stats };
  }
);

const departmentSlice = createSlice({
  name: 'departments',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    updateDepartmentOEE: (state, action) => {
      const { departmentId, avgOEE } = action.payload;
      const department = state.departments.find(d => d._id === departmentId);
      if (department) {
        department.avgOEE = avgOEE;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch departments
      .addCase(fetchDepartments.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDepartments.fulfilled, (state, action) => {
        state.loading = false;
        state.departments = action.payload;
      })
      .addCase(fetchDepartments.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch departments';
      })
      // Fetch departments admin
      .addCase(fetchDepartmentsAdmin.fulfilled, (state, action) => {
        state.loading = false;
        state.departments = action.payload.departments;
        state.pagination = action.payload.pagination;
        state.filters = action.payload.filters;
      })
      // Fetch single department
      .addCase(fetchDepartment.fulfilled, (state, action) => {
        state.currentDepartment = action.payload;
      })
      // Create department
      .addCase(createDepartment.fulfilled, (state, action) => {
        state.departments.push(action.payload);
      })
      // Update department
      .addCase(updateDepartment.fulfilled, (state, action) => {
        const index = state.departments.findIndex(d => d._id === action.payload._id);
        if (index !== -1) {
          state.departments[index] = action.payload;
        }
        if (state.currentDepartment?._id === action.payload._id) {
          state.currentDepartment = action.payload;
        }
      })
      // Delete department
      .addCase(deleteDepartment.fulfilled, (state, action) => {
        state.departments = state.departments.filter(d => d._id !== action.payload);
      })
      // Department stats
      .addCase(fetchDepartmentStats.fulfilled, (state, action) => {
        const { departmentId, stats } = action.payload;
        const department = state.departments.find(d => d._id === departmentId);
        if (department) {
          department.avgOEE = stats.avgOEE;
        }
      });
  },
});

export const { clearError, setFilters, updateDepartmentOEE } = departmentSlice.actions;
export default departmentSlice.reducer;
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { Mold } from '../../types';
import apiService from '../../services/api';

interface MoldState {
  molds: Mold[];
  loading: boolean;
  error: string | null;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalMolds: number;
    limit: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  } | null;
  filters: {
    search: string;
    department: string;
    isActive: string;
    sortBy: string;
    sortOrder: string;
  };
}

const initialState: MoldState = {
  molds: [],
  loading: false,
  error: null,
  pagination: null,
  filters: {
    search: '',
    department: '',
    isActive: '',
    sortBy: 'name',
    sortOrder: 'asc',
  },
};

// Async thunks
export const fetchMolds = createAsyncThunk(
  'molds/fetchMolds',
  async () => {
    return await apiService.getMolds();
  }
);

export const fetchMoldsAdmin = createAsyncThunk(
  'molds/fetchMoldsAdmin',
  async (params: {
    page?: number;
    limit?: number;
    search?: string;
    department?: string;
    isActive?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => {
    return await apiService.getMoldsAdmin(params);
  }
);

export const createMold = createAsyncThunk(
  'molds/createMold',
  async (moldData: Partial<Mold>) => {
    return await apiService.createMold(moldData);
  }
);

export const updateMold = createAsyncThunk(
  'molds/updateMold',
  async ({ id, data }: { id: string; data: Partial<Mold> }) => {
    return await apiService.updateMold(id, data);
  }
);

export const deleteMold = createAsyncThunk(
  'molds/deleteMold',
  async (id: string) => {
    await apiService.deleteMold(id);
    return id;
  }
);

export const toggleMoldStatus = createAsyncThunk(
  'molds/toggleMoldStatus',
  async (id: string) => {
    return await apiService.toggleMoldStatus(id);
  }
);

const moldSlice = createSlice({
  name: 'molds',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch molds
      .addCase(fetchMolds.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMolds.fulfilled, (state, action) => {
        state.loading = false;
        state.molds = action.payload;
      })
      .addCase(fetchMolds.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch molds';
      })
      // Fetch molds admin
      .addCase(fetchMoldsAdmin.fulfilled, (state, action) => {
        state.loading = false;
        state.molds = action.payload.molds;
        state.pagination = action.payload.pagination;
        state.filters = action.payload.filters;
      })
      // Create mold
      .addCase(createMold.fulfilled, (state, action) => {
        state.molds.push(action.payload);
      })
      // Update mold
      .addCase(updateMold.fulfilled, (state, action) => {
        const index = state.molds.findIndex(m => m._id === action.payload._id);
        if (index !== -1) {
          state.molds[index] = action.payload;
        }
      })
      // Delete mold
      .addCase(deleteMold.fulfilled, (state, action) => {
        state.molds = state.molds.filter(m => m._id !== action.payload);
      })
      // Toggle mold status
      .addCase(toggleMoldStatus.fulfilled, (state, action) => {
        const mold = state.molds.find(m => m._id === action.meta.arg);
        if (mold) {
          mold.isActive = !mold.isActive;
        }
      });
  },
});

export const { clearError, setFilters } = moldSlice.actions;
export default moldSlice.reducer;
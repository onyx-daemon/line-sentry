import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { Config } from '../../types';
import apiService from '../../services/api';

interface ConfigState {
  config: Config | null;
  shifts: Array<{
    name: string;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }>;
  loading: boolean;
  error: string | null;
}

const initialState: ConfigState = {
  config: null,
  shifts: [],
  loading: false,
  error: null,
};

// Async thunks
export const fetchConfig = createAsyncThunk(
  'config/fetchConfig',
  async () => {
    return await apiService.getConfig();
  }
);

export const fetchShifts = createAsyncThunk(
  'config/fetchShifts',
  async () => {
    return await apiService.getShifts();
  }
);

export const updateConfig = createAsyncThunk(
  'config/updateConfig',
  async (configData: Partial<Config>) => {
    return await apiService.updateConfig(configData);
  }
);

const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch config
      .addCase(fetchConfig.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchConfig.fulfilled, (state, action) => {
        state.loading = false;
        state.config = action.payload;
        state.shifts = action.payload.shifts || [];
      })
      .addCase(fetchConfig.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch configuration';
      })
      // Fetch shifts
      .addCase(fetchShifts.fulfilled, (state, action) => {
        state.shifts = action.payload;
      })
      // Update config
      .addCase(updateConfig.fulfilled, (state, action) => {
        state.config = action.payload;
        state.shifts = action.payload.shifts || [];
      });
  },
});

export const { clearError } = configSlice.actions;
export default configSlice.reducer;
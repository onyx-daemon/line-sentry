import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { ProductionTimelineDay, MachineStats } from '../../types';
import apiService from '../../services/api';

interface AnalyticsState {
  productionTimeline: ProductionTimelineDay[];
  factoryStats: {
    totalUnits: number;
    avgOEE: number;
    unclassifiedStoppages: number;
    activeMachines: number;
  };
  departmentStats: { [departmentId: string]: { avgOEE: number } };
  loading: boolean;
  error: string | null;
}

const initialState: AnalyticsState = {
  productionTimeline: [],
  factoryStats: {
    totalUnits: 0,
    avgOEE: 0,
    unclassifiedStoppages: 0,
    activeMachines: 0,
  },
  departmentStats: {},
  loading: false,
  error: null,
};

// Async thunks
export const fetchProductionTimeline = createAsyncThunk(
  'analytics/fetchProductionTimeline',
  async ({ 
    machineId, 
    timeframe, 
    startDate, 
    endDate 
  }: { 
    machineId: string; 
    timeframe?: string; 
    startDate?: string; 
    endDate?: string 
  }) => {
    return await apiService.getProductionTimeline(machineId, { 
      timeframe, 
      startDate, 
      endDate 
    });
  }
);

export const fetchFactoryStats = createAsyncThunk(
  'analytics/fetchFactoryStats',
  async () => {
    return await apiService.getFactoryStats();
  }
);

export const fetchDepartmentStats = createAsyncThunk(
  'analytics/fetchDepartmentStats',
  async (departmentId: string) => {
    const stats = await apiService.getDepartmentStats(departmentId);
    return { departmentId, stats };
  }
);

export const addStoppageRecord = createAsyncThunk(
  'analytics/addStoppageRecord',
  async (stoppageData: any) => {
    return await apiService.addStoppageRecord(stoppageData);
  }
);

export const updateProductionAssignment = createAsyncThunk(
  'analytics/updateProductionAssignment',
  async (assignmentData: any) => {
    return await apiService.updateProductionAssignment(assignmentData);
  }
);

const analyticsSlice = createSlice({
  name: 'analytics',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    updateFactoryStats: (state, action) => {
      state.factoryStats = { ...state.factoryStats, ...action.payload };
    },
    updateDepartmentStats: (state, action) => {
      const { departmentId, stats } = action.payload;
      state.departmentStats[departmentId] = stats;
    },
    updateProductionTimelineHour: (state, action) => {
      const { date, hour, data } = action.payload;
      const dayIndex = state.productionTimeline.findIndex(d => d.date === date);
      if (dayIndex !== -1) {
        const hourIndex = state.productionTimeline[dayIndex].hours.findIndex(h => h.hour === hour);
        if (hourIndex !== -1) {
          state.productionTimeline[dayIndex].hours[hourIndex] = {
            ...state.productionTimeline[dayIndex].hours[hourIndex],
            ...data
          };
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch production timeline
      .addCase(fetchProductionTimeline.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchProductionTimeline.fulfilled, (state, action) => {
        state.loading = false;
        state.productionTimeline = action.payload.timeline;
      })
      .addCase(fetchProductionTimeline.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch production timeline';
      })
      // Fetch factory stats
      .addCase(fetchFactoryStats.fulfilled, (state, action) => {
        state.factoryStats = action.payload;
      })
      // Fetch department stats
      .addCase(fetchDepartmentStats.fulfilled, (state, action) => {
        const { departmentId, stats } = action.payload;
        state.departmentStats[departmentId] = stats;
      })
      // Add stoppage record
      .addCase(addStoppageRecord.fulfilled, (state) => {
        // Refresh timeline data after adding stoppage
        state.error = null;
      })
      // Update production assignment
      .addCase(updateProductionAssignment.fulfilled, (state) => {
        // Refresh timeline data after updating assignment
        state.error = null;
      });
  },
});

export const { 
  clearError, 
  updateFactoryStats, 
  updateDepartmentStats, 
  updateProductionTimelineHour 
} = analyticsSlice.actions;
export default analyticsSlice.reducer;
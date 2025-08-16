import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { Machine, MachineStats } from '../../types';
import apiService from '../../services/api';

interface MachineState {
  machines: Machine[];
  currentMachine: Machine | null;
  machineStats: { [machineId: string]: MachineStats };
  machineStatuses: { [machineId: string]: string };
  loading: boolean;
  error: string | null;
}

const initialState: MachineState = {
  machines: [],
  currentMachine: null,
  machineStats: {},
  machineStatuses: {},
  loading: false,
  error: null,
};

// Async thunks
export const fetchMachinesByDepartment = createAsyncThunk(
  'machines/fetchMachinesByDepartment',
  async (departmentId: string) => {
    return await apiService.getMachinesByDepartment(departmentId);
  }
);

export const fetchMachine = createAsyncThunk(
  'machines/fetchMachine',
  async (id: string) => {
    return await apiService.getMachine(id);
  }
);

export const fetchAllMachines = createAsyncThunk(
  'machines/fetchAllMachines',
  async () => {
    return await apiService.getMachines();
  }
);

export const createMachine = createAsyncThunk(
  'machines/createMachine',
  async (machineData: Partial<Machine>) => {
    return await apiService.createMachine(machineData);
  }
);

export const updateMachine = createAsyncThunk(
  'machines/updateMachine',
  async ({ id, data }: { id: string; data: Partial<Machine> }) => {
    return await apiService.updateMachine(id, data);
  }
);

export const updateMachinePosition = createAsyncThunk(
  'machines/updateMachinePosition',
  async ({ 
    id, 
    position, 
    dimensions 
  }: { 
    id: string; 
    position: { x: number; y: number }; 
    dimensions: { width: number; height: number } 
  }) => {
    await apiService.updateMachinePosition(id, position, dimensions);
    return { id, position, dimensions };
  }
);

export const deleteMachine = createAsyncThunk(
  'machines/deleteMachine',
  async (id: string) => {
    await apiService.deleteMachine(id);
    return id;
  }
);

export const fetchMachineStats = createAsyncThunk(
  'machines/fetchMachineStats',
  async ({ 
    machineId, 
    startDate, 
    endDate 
  }: { 
    machineId: string; 
    startDate: string; 
    endDate: string 
  }) => {
    const stats = await apiService.getMachineStats(machineId, { startDate, endDate });
    return { machineId, stats };
  }
);

const machineSlice = createSlice({
  name: 'machines',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    updateMachineStatus: (state, action) => {
      const { machineId, status } = action.payload;
      state.machineStatuses[machineId] = status;
      
      // Update machine in arrays
      const machine = state.machines.find(m => m._id === machineId);
      if (machine) {
        machine.status = status;
      }
      
      if (state.currentMachine?._id === machineId) {
        state.currentMachine.status = status;
      }
    },
    updateMachineStats: (state, action) => {
      const { machineId, stats } = action.payload;
      state.machineStats[machineId] = stats;
    },
    setMachines: (state, action) => {
      state.machines = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch machines by department
      .addCase(fetchMachinesByDepartment.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMachinesByDepartment.fulfilled, (state, action) => {
        state.loading = false;
        state.machines = action.payload;
      })
      .addCase(fetchMachinesByDepartment.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch machines';
      })
      // Fetch single machine
      .addCase(fetchMachine.fulfilled, (state, action) => {
        state.currentMachine = action.payload;
      })
      // Fetch all machines
      .addCase(fetchAllMachines.fulfilled, (state, action) => {
        state.machines = action.payload;
      })
      // Create machine
      .addCase(createMachine.fulfilled, (state, action) => {
        state.machines.push(action.payload);
      })
      // Update machine
      .addCase(updateMachine.fulfilled, (state, action) => {
        const index = state.machines.findIndex(m => m._id === action.payload._id);
        if (index !== -1) {
          state.machines[index] = action.payload;
        }
        if (state.currentMachine?._id === action.payload._id) {
          state.currentMachine = action.payload;
        }
      })
      // Update machine position
      .addCase(updateMachinePosition.fulfilled, (state, action) => {
        const { id, position, dimensions } = action.payload;
        const machine = state.machines.find(m => m._id === id);
        if (machine) {
          machine.position = position;
          machine.dimensions = dimensions;
        }
        if (state.currentMachine?._id === id) {
          state.currentMachine.position = position;
          state.currentMachine.dimensions = dimensions;
        }
      })
      // Delete machine
      .addCase(deleteMachine.fulfilled, (state, action) => {
        state.machines = state.machines.filter(m => m._id !== action.payload);
        if (state.currentMachine?._id === action.payload) {
          state.currentMachine = null;
        }
      })
      // Fetch machine stats
      .addCase(fetchMachineStats.fulfilled, (state, action) => {
        const { machineId, stats } = action.payload;
        state.machineStats[machineId] = stats;
      });
  },
});

export const { 
  clearError, 
  updateMachineStatus, 
  updateMachineStats, 
  setMachines 
} = machineSlice.actions;
export default machineSlice.reducer;
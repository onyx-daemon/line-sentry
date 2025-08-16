import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import departmentReducer from './slices/departmentSlice';
import machineReducer from './slices/machineSlice';
import userReducer from './slices/userSlice';
import sensorReducer from './slices/sensorSlice';
import moldReducer from './slices/moldSlice';
import reportReducer from './slices/reportSlice';
import configReducer from './slices/configSlice';
import analyticsReducer from './slices/analyticsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    departments: departmentReducer,
    machines: machineReducer,
    users: userReducer,
    sensors: sensorReducer,
    molds: moldReducer,
    reports: reportReducer,
    config: configReducer,
    analytics: analyticsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
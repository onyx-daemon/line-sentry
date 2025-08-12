import React from 'react';
import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import DepartmentView from './components/DepartmentView';
import MachineView from './components/MachineView';
import Departments from './components/Departments';
import Users from './components/Users';
import Sensors from './components/Sensors';
import Molds from './components/Molds';
import Configuration from './components/Configuration';
import Reports from './components/Reports';


const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
};

// Theme Context
export const ThemeContext = React.createContext<{
  isDarkMode: boolean;
  toggleTheme: () => void;
}>({
  isDarkMode: true,
  toggleTheme: () => {}
});
const App: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState(true);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };
  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme }}>
      <div className={isDarkMode ? 'dark' : ''}>
    <AuthProvider>
      <Router future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true
          }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="departments" element={<Departments />} />
            <Route path="department/:id" element={<DepartmentView />} />
            <Route path="machine/:id" element={<MachineView />} />
            <Route path="users" element={<Users/>} />
            <Route path="sensors" element={<Sensors />} />
            <Route path="molds" element={<Molds/>} />
            <Route path="reports" element={<Reports />} />
            <Route path="config" element={<Configuration />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
      </div>
    </ThemeContext.Provider>
  );
};

export default App;
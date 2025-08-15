import React, { useEffect, useState } from 'react';
import { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ThemeContext } from '../App';
import { Department } from '../types';
import apiService from '../services/api';
import socketService from '../services/socket';
import { 
  Building2, 
  Activity, 
  TrendingUp, 
  AlertTriangle,
  Users,
  Gauge
} from 'lucide-react';

const Dashboard: React.FC = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [factoryStats, setFactoryStats] = useState({
    totalUnits: 0,
    avgOEE: 0,
    unclassifiedStoppages: 0,
    activeMachines: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user, isOperator } = useAuth();
  const { isDarkMode } = useContext(ThemeContext);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDepartments();
    fetchFactoryStats();
    setupSocketListeners();
  }, []);

  const setupSocketListeners = () => {
    socketService.connect();

    const handleProductionUpdate = () => {
      fetchFactoryStats();
      fetchDepartments();
    };

    const handleStoppageUpdate = () => {
      fetchFactoryStats();
    };

    const handleMachineStateUpdate = () => {
      fetchFactoryStats();
    };

    socketService.on('production-update', handleProductionUpdate);
    socketService.on('stoppage-added', handleStoppageUpdate);
    socketService.on('unclassified-stoppage-detected', handleStoppageUpdate);
    socketService.on('machine-state-update', handleMachineStateUpdate);

    return () => {
      socketService.off('production-update', handleProductionUpdate);
      socketService.off('stoppage-added', handleStoppageUpdate);
      socketService.off('unclassified-stoppage-detected', handleStoppageUpdate);
      socketService.off('machine-state-update', handleMachineStateUpdate);
    };
  };

  const fetchDepartments = async () => {
    try {
      // Pass limit=10 parameter to get only 10 departments
      const data = await apiService.getDepartment('?limit=10');
      const departmentsWithOEE = await Promise.all(data.map(async (dept: any) => {
        const stats = await apiService.getDepartmentStats(dept._id);
        return { ...dept, avgOEE: stats.avgOEE };
      }));

      setDepartments(departmentsWithOEE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch departments');
    } finally {
      setLoading(false);
    }
  };

  const fetchFactoryStats = async () => {
    try {
      const stats = await apiService.getFactoryStats();
      setFactoryStats({
        totalUnits: stats.totalUnits,
        avgOEE: stats.avgOEE,
        unclassifiedStoppages: stats.unclassifiedStoppages,
        activeMachines: stats.activeMachines
      });
    } catch (err) {
      console.error('Failed to fetch factory stats:', err);
    }
  };

  const handleDepartmentClick = (departmentId: string) => {
    navigate(`/department/${departmentId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  };

  if (error) {
    return (
      <div className={`border rounded-lg p-4 ${
        isDarkMode 
          ? 'bg-red-900/20 border-red-800 text-red-200' 
          : 'bg-red-50 border-red-200 text-red-800'
      }`}>
        <div className="flex items-center">
          <AlertTriangle className="h-4 w-4 mr-2" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
      {/* Welcome Header */}
      <div className={`bg-gradient-to-r rounded-xl p-6 text-white shadow-lg ${
        isDarkMode 
          ? 'from-blue-600 to-indigo-700' 
          : 'from-blue-600 to-purple-600'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Welcome back, {user?.username}</h1>
            <p className="text-blue-100 mt-1">
              {isOperator 
                ? `Monitoring ${user?.department?.name || 'your department'}`
                : 'System overview and management'
              }
            </p>
          </div>
          <div className="hidden sm:block">
            <div className="flex items-center space-x-2 text-blue-100">
              <Users className="h-5 w-5" />
              <span className="capitalize">{user?.role}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className={`grid grid-cols-1 ${ isOperator ? 'md:grid-cols-3': 'md:grid-cols-4' } gap-6`}>
        <div className={`p-6 rounded-xl border transition-all duration-200 hover:shadow-lg ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-700 hover:border-gray-600' 
            : 'bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
        }`}>
          <div className="flex items-center">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Departments</p>
              <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{departments.length}</p>
            </div>
          </div>
        </div>

        <div className={`p-6 rounded-xl border transition-all duration-200 hover:shadow-lg ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-700 hover:border-gray-600' 
            : 'bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
        }`}>
          <div className="flex items-center">
            <div className="p-3 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-lg">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Active Machines</p>
              <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {departments.reduce((total, dept) => total + dept.machineCount, 0)}
              </p>
            </div>
          </div>
        </div>

       {!isOperator && <div className={`p-6 rounded-xl border transition-all duration-200 hover:shadow-lg ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-700 hover:border-gray-600' 
            : 'bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
        }`}>
          <div className="flex items-center">
            <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl shadow-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Avg OEE (YTD)</p>
              <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{factoryStats.avgOEE}%</p>
            </div>
          </div>
        </div>
        }

        <div className={`p-6 rounded-xl border transition-all duration-200 hover:shadow-lg ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-700 hover:border-gray-600' 
            : 'bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
        }`}>
          <div className="flex items-center">
            <div className="p-3 bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div className="ml-4">
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Unclassified Stoppages</p>
              <p className={`text-2xl font-bold ${
                factoryStats.unclassifiedStoppages > 0 
                  ? 'text-red-500 animate-pulse' 
                  : (isDarkMode ? 'text-white' : 'text-gray-900')
              }`}>
                {factoryStats.unclassifiedStoppages}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Departments Grid */}
      <div>
        <h2 className={`text-xl font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          {isOperator ? 'Your Department' : 'Departments Overview'}
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {departments.map((department) => (
            <div
              key={department._id}
              onClick={() => handleDepartmentClick(department._id)}
              className={`rounded-xl border cursor-pointer transition-all duration-300 group ${
                isDarkMode 
                  ? 'bg-gray-800 border-gray-700 hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/10' 
                  : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-xl shadow-sm hover:shadow-blue-100/50'
              }`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{department.name}</h3>
                  <div className={`p-2 rounded-lg transition-colors ${
                    isDarkMode ? 'bg-gray-700 group-hover:bg-blue-600' : 'bg-gray-100 group-hover:bg-blue-600'
                  }`}>
                    <Building2 className={`h-5 w-5 transition-colors ${
                      isDarkMode ? 'text-blue-400 group-hover:text-white' : 'text-gray-600 group-hover:text-white'
                    }`} />
                  </div>
                </div>
                
                <p className={`text-sm mb-4 line-clamp-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {department.description || 'No description available'}
                </p>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Machines</span>
                    <span className={`font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {department.machineCount || 0}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Status</span>
                    <div className="flex items-center space-x-2">
                      <div className="h-2 w-2 bg-emerald-500 rounded-full animate-pulse"></div>
                      <span className="text-emerald-600 text-sm font-semibold">Active</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>OEE (YTD)</span >
                    <div className="flex items-center space-x-2">
                      <Gauge className="h-4 w-4 text-amber-500" />
                      <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {department.avgOEE ? `${department.avgOEE}%` : `N/A`} 
                      </span>
                    </div>
                  </div>

                </div>

                <div className={`mt-6 pt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <button className={`w-full text-sm font-semibold transition-colors py-2 px-4 rounded-lg ${
                    isDarkMode 
                      ? 'text-blue-400 hover:text-white hover:bg-blue-600' 
                      : 'text-blue-600 hover:text-white hover:bg-blue-600'
                  }`}>
                    View Details →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {departments.length === 0 && (
          <div className={`text-center py-16 rounded-xl ${
            isDarkMode ? 'bg-gray-800/50' : 'bg-gray-50'
          }`}>
            <div className={`inline-flex p-4 rounded-full mb-4 ${
              isDarkMode ? 'bg-gray-700' : 'bg-gray-200'
            }`}>
              <Building2 className={`h-8 w-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            </div>
            <h3 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>No departments found</h3>
            <p className={`max-w-md mx-auto ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {isOperator 
                ? 'You have not been assigned to any department yet. Please contact your administrator.'
                : 'Get started by creating your first department to begin monitoring your factory operations.'
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
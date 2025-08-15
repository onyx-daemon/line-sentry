import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Machine, MachineStats, MachineStatus } from '../types';
import apiService from '../services/api';
import socketService from '../services/socket';
import ProductionTimeline from './ProductionTimeline';
import { ToastContainer, toast } from 'react-toastify';
import { format, startOfYear, startOfMonth, startOfWeek, startOfDay } from 'date-fns';
import 'react-toastify/dist/ReactToastify.css';
import {
  ArrowLeft,
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
  Zap,
  ZapOff,
  Edit,
  Info,
  Calendar,
  Check,
} from 'lucide-react';
import { ThemeContext } from '../App';

const MachineView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isDarkMode } = useContext(ThemeContext);
  const [machine, setMachine] = useState<Machine | null>(null);
  const [stats, setStats] = useState<MachineStats | null>(null);
  const [ytdStats, setYtdStats] = useState<MachineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedCustomDates, setAppliedCustomDates] = useState({ start: '', end: '' });
  const [machineStatus, setMachineStatus] = useState<string>('inactive');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: ''
  });
  const [tooltip, setTooltip] = useState<{
    content: string;
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);

  // Theme classes
  const bgClass = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBgClass = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const cardBorderClass = isDarkMode ? 'border-gray-700' : 'border-gray-200';
  const textClass = isDarkMode ? 'text-white' : 'text-gray-900';
  const textSecondaryClass = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const inputBgClass = isDarkMode ? 'bg-gray-700' : 'bg-white';
  const inputBorderClass = isDarkMode ? 'border-gray-600' : 'border-gray-300';
  const buttonPrimaryClass = isDarkMode 
    ? 'bg-blue-600 hover:bg-blue-700' 
    : 'bg-blue-600 hover:bg-blue-500';
  const buttonSecondaryClass = isDarkMode 
    ? 'border-gray-600 text-gray-300 hover:bg-gray-700' 
    : 'border-gray-300 text-gray-700 hover:bg-gray-100';

  // Handle mouse events for tooltip
  const handleMouseEnter = (content: string) => (e: React.MouseEvent) => {
    setTooltip({
      content,
      x: e.clientX,
      y: e.clientY,
      visible: true
    });
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (tooltip) {
      setTooltip({
        ...tooltip,
        x: e.clientX,
        y: e.clientY
      });
    }
  };

  // Helper function to format date
  const formatUTCDate = (date: Date) => {
    return format(date, 'yyyy-MM-dd');
  };

  // Adjust getDateRange to use UTC-based calculations
  const getDateRange = () => {
    const now = new Date();
    
    switch (selectedPeriod) {
      case 'today':
        return {
          startDate: formatUTCDate(startOfDay(now)),
          endDate: formatUTCDate(now)
        };
      case 'week':
        return {
          startDate: formatUTCDate(startOfWeek(now)),
          endDate: formatUTCDate(now)
        };
      case 'month':
        return {
          startDate: formatUTCDate(startOfMonth(now)),
          endDate: formatUTCDate(now)
        };
      case 'year':
        return {
          startDate: formatUTCDate(startOfYear(now)),
          endDate: formatUTCDate(now)
        };
      case 'custom':
        return {
          startDate: appliedCustomDates.start || customStartDate,
          endDate: appliedCustomDates.end || customEndDate
        };
      default:
        return {
          startDate: formatUTCDate(startOfDay(now)),
          endDate: formatUTCDate(now)
        };
    }
  };


  const handleApplyCustomDates = () => {
    if (!customStartDate || !customEndDate) {
      toast.error('Please select both start and end dates');
      return;
    }
    
    if (customStartDate > customEndDate) {
      toast.error('Start date must be before end date');
      return;
    }
    
    setAppliedCustomDates({ start: customStartDate, end: customEndDate });
  };

  // Check if custom dates have changed but not applied
  const hasUnappliedChanges = selectedPeriod === 'custom' && 
    (customStartDate !== appliedCustomDates.start || customEndDate !== appliedCustomDates.end) &&
    customStartDate && customEndDate;

  useEffect(() => {
    if (id) {
      fetchMachineData();
      setupSocketListeners();
    }
    return () => {
      if (id) {
        socketService.leaveMachine(id);
      }
    };
  }, [id, selectedPeriod, appliedCustomDates]);

   const fetchYtdStats = async () => {
    try {
      const now = new Date();
      const ytdStart = formatUTCDate(startOfYear(now));
      const response = await apiService.request(`/analytics/machine-stats/${id}`, {
        method: 'GET',
        params: {
          startDate: ytdStart,
          endDate: formatUTCDate(now)
        }
      });
      setYtdStats(response);
    } catch (err) {
      console.error('Failed to fetch YTD stats:', err);
    }
  };

  // Fetch year-to-date stats on component mount
  useEffect(() => {
    if (!id) return;
    fetchYtdStats();
  }, [id]);

  const setupSocketListeners = () => {
    if (!id) return;

    socketService.connect();
    socketService.joinMachine(id);

    const handleProductionUpdate = (update: any) => {
      if (update.machineId === id) {
        fetchStats();
        fetchYtdStats();
      }
    };

    const handleAssignmentUpdated = (update: any) => {
      if (update.machineId === id) {
        fetchStats();
        fetchYtdStats();
      }
    };

    const handleStoppageUpdated = (update: any) => {
      if (update.machineId === id) {
        fetchStats();
        fetchYtdStats();
      }
    };

    const handleStoppageDetected = (stoppage: any) => {
      if (stoppage.machineId === id) {
        toast.warning(`Stoppage detected: ${stoppage.duration} minutes`, {
          position: "top-right",
          autoClose: 5000,
          theme: isDarkMode ? "dark" : "light"
        });
        fetchMachineData();
        fetchYtdStats();
      }
    };

    const handleMachineStateUpdate = (update: any) => {
      if (update.machineId === id) {
        setMachineStatus(update.status);
        setMachine(prev => prev ? { ...prev, status: update.dbStatus } : null);
      }
    };

    socketService.on('production-update', handleProductionUpdate);
    socketService.on('stoppage-detected', handleStoppageDetected);
    socketService.on('production-assignment-updated', handleAssignmentUpdated);
    socketService.on('stoppage-updated', handleStoppageUpdated);
    socketService.on('stoppage-added', handleStoppageDetected);
    socketService.on('machine-state-update', handleMachineStateUpdate);

    return () => {
      socketService.off('production-update', handleProductionUpdate);
      socketService.off('stoppage-detected', handleStoppageDetected);
      socketService.off('stoppage-added', handleStoppageDetected);
      socketService.off('machine-state-update', handleMachineStateUpdate);
      socketService.off('production-assignment-updated', handleAssignmentUpdated);
      socketService.off('stoppage-updated', handleStoppageUpdated);
    };
  };

  const fetchMachineData = async () => {
    try {
      setLoading(true);
      const machineData = await apiService.getMachine(id!);
      
      setMachine(machineData);
      setEditForm({
        name: machineData.name,
        description: machineData.description || ''
      });

      
      // Fetch stats for selected period
      const { startDate, endDate } = getDateRange();
      const [statsData] = await Promise.all([
        apiService.request(`/analytics/machine-stats/${id}`, {
          method: 'GET',
          params: { startDate, endDate }
        })
      ]);
      
      setStats(statsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch machine data';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { startDate, endDate } = getDateRange();
      const statsData = await apiService.request(`/analytics/machine-stats/${id}`, {
        method: 'GET',
        params: {
          startDate,
          endDate
        }
      });
      setStats(statsData);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const handleAddStoppage = async (stoppage: any) => {
    try {
      await apiService.addStoppageRecord({
        ...stoppage,
        machineId: id
      });
      toast.success('Stoppage recorded successfully');
      fetchMachineData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record stoppage');
    }
  };

  const handleUpdateProduction = async (machineId: string, hour: number, date: string, data: any) => {
    try {
      await apiService.updateProductionAssignment({
        machineId,
        hour,
        date,
        ...data
      });
      toast.success('Production data updated');
      fetchStats();
      fetchMachineData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update production data');
    }
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEditForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveEdit = async () => {
    if (!machine || !id) return;
    
    try {
      const updatedMachine = await apiService.updateMachine(id, editForm);
      setMachine(updatedMachine);
      setIsEditing(false);
      toast.success('Machine details updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update machine');
    }
  };

  const getStatusColor = (status: MachineStatus) => {
    switch (status) {
      case 'running': return 'text-green-400 bg-green-400/10 border-green-400/20';
      case 'stoppage': return 'text-red-400 bg-red-400/10 border-red-400/20 animate-pulse';
      case 'stopped_yet_producing': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
      case 'inactive': return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
      default: return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
    }
  };

  const getStatusIcon = (status: MachineStatus) => {
    switch (status) {
      case 'running': return <Zap className="h-4 w-4" />;
      case 'stoppage': return <AlertTriangle className="h-4 w-4" />;
      case 'stopped_yet_producing': return <ZapOff className="h-4 w-4" />;
      case 'inactive': return <Activity className="h-4 w-4" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-64 ${bgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!machine || !stats || !ytdStats) {
    return (
      <div className={`text-center py-12 ${bgClass}`}>
        <p className={textSecondaryClass}>Machine not found</p>
      </div>
    );
  }

  // Convert MTBF to days for YTD display
  const mtbfDays = ytdStats.mtbf > 0 ? (ytdStats.mtbf / 1440).toFixed(1) : 0;

  return (
    <div className={`space-y-6 min-h-screen p-4 ${bgClass}`}>
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme={isDarkMode ? "dark" : "light"}
      />
      
      {/* Custom Tooltip */}
      {tooltip && (
        <div 
          className={`fixed text-sm px-3 py-2 rounded-md shadow-lg z-50 border transition-opacity ${
            tooltip.visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          } ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-200'}`}
          style={{
            left: tooltip.x + 10,
            top: tooltip.y + 10,
            transform: 'translate(0, -50%)',
            maxWidth: '300px'
          }}
        >
          {tooltip.content}
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(-1)}
            className={`p-2 ${textSecondaryClass} hover:${textClass} hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-md transition-colors`}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          {isEditing ? (
            <div className="space-y-2 flex-1">
              <input
                name="name"
                value={editForm.name}
                onChange={handleEditChange}
                className={`text-2xl font-bold ${textClass} ${inputBgClass} border ${inputBorderClass} rounded px-2 py-1 w-full`}
              />
              <textarea
                name="description"
                value={editForm.description}
                onChange={handleEditChange}
                className={`${textSecondaryClass} ${inputBgClass} border ${inputBorderClass} rounded px-2 py-1 w-full text-sm`}
                rows={2}
              />
            </div>
          ) : (
            <div>
              <h1 className={`text-2xl font-bold ${textClass}`}>{machine.name}</h1>
              <p className={textSecondaryClass}>{machine.description}</p>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-3">
          <div className={`flex items-center space-x-2 px-3 py-2 rounded-md border ${getStatusColor(machineStatus as MachineStatus || machine.status)}`}>
            {getStatusIcon(machineStatus as MachineStatus || machine.status)}
            <span className="font-medium capitalize">{(machineStatus || machine.status).replace('_', ' ')}</span>
          </div>
          
          {isEditing ? (
            <div className="flex space-x-2">
              <button
                onClick={() => setIsEditing(false)}
                className={`px-3 py-2 ${buttonSecondaryClass} rounded-md`}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className={`px-3 py-2 ${buttonPrimaryClass} text-white rounded-md`}
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className={`p-2 ${textSecondaryClass} hover:${textClass} hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-md transition-colors`}
              title="Edit machine details"
            >
              <Edit className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Key Metrics - Year to Date */}
      <div className="grid grid-cols-3 gap-2">
        <div 
          className={`p-3 rounded-lg border flex items-center relative ${cardBgClass} ${cardBorderClass}`}
          onMouseEnter={handleMouseEnter('Overall Equipment Effectiveness (Year to Date)')}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
        >
          <Gauge className={`h-6 w-6 mr-3 ${isDarkMode ? 'text-yellow-400' : 'text-amber-500'}`} />
          <div>
            <p className={`text-xs flex items-center ${textSecondaryClass}`}>
              OEE (YTD)
              <Info className="h-3 w-3 ml-1" />
            </p>
            <p className={`text-lg font-semibold ${isDarkMode ? 'text-yellow-400' : 'text-amber-600'}`}>
              {ytdStats.oee}%
            </p>
          </div>
        </div>

        <div 
          className={`p-3 rounded-lg border flex items-center relative ${cardBgClass} ${cardBorderClass}`}
          onMouseEnter={handleMouseEnter('Mean Time Between Failures in days (Year to Date)')}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
        >
          <Clock className={`h-6 w-6 mr-3 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
          <div>
            <p className={`text-xs flex items-center ${textSecondaryClass}`}>
              MTBF (YTD)
              <Info className="h-3 w-3 ml-1" />
            </p>
            <p className={`text-lg font-semibold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
              {mtbfDays} days
            </p>
          </div>
        </div>

        <div 
          className={`p-3 rounded-lg border flex items-center relative ${cardBgClass} ${cardBorderClass}`}
          onMouseEnter={handleMouseEnter('Mean Time To Repair in minutes (Year to Date)')}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
        >
          <Activity className={`h-6 w-6 mr-3 ${isDarkMode ? 'text-purple-400' : 'text-purple-500'}`} />
          <div>
            <p className={`text-xs flex items-center ${textSecondaryClass}`}>
              MTTR (YTD)
              <Info className="h-3 w-3 ml-1" />
            </p>
            <p className={`text-lg font-semibold ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`}>
              {ytdStats.mttr} min
            </p>
          </div>
        </div>
      </div>

      {/* Time Period Selector */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center space-y-2 md:space-y-0 md:space-x-4">
          <span className={`text-sm font-medium ${textSecondaryClass}`}>View Analytics For:</span>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This Week' },
              { value: 'month', label: 'Month to Date' },
              { value: 'year', label: 'Year to Date' },
              { value: 'custom', label: 'Custom Range' }
            ].map((period) => (
              <button
                key={period.value}
                onClick={() => setSelectedPeriod(period.value as any)}
                className={`px-4 py-2 text-sm rounded-lg transition-all duration-200 flex items-center font-medium ${
                  selectedPeriod === period.value
                    ? 'bg-blue-600 text-white shadow-md transform scale-105'
                    : `${buttonSecondaryClass} hover:shadow-sm`
                }`}
              >
                {period.value === 'custom' && <Calendar className="h-4 w-4 mr-2" />}
                {period.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Enhanced Custom Date Picker */}
        {selectedPeriod === 'custom' && (
          <div className={`rounded-xl p-6 border-2 border-dashed transition-all duration-300 ${
            isDarkMode 
              ? 'bg-gray-800/50 border-gray-600 hover:border-gray-500 hover:bg-gray-800/70' 
              : 'bg-blue-50/50 border-blue-200 hover:border-blue-300 hover:bg-blue-50/70'
          }`}>
            <div className="flex items-center space-x-3 mb-4">
              <Calendar className={`h-5 w-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <h3 className={`text-lg font-semibold ${textClass}`}>Custom Date Range</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              {/* Start Date */}
              <div className="space-y-2">
                <label className={`text-sm font-medium ${textSecondaryClass} block`}>
                  Start Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className={`w-full px-4 py-3 rounded-lg border-2 transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      isDarkMode
                        ? 'bg-gray-700 border-gray-600 text-white focus:bg-gray-600'
                        : 'bg-white border-gray-300 text-gray-900 focus:bg-gray-50'
                    }`}
                  />
                </div>
              </div>
              
              {/* End Date */}
              <div className="space-y-2">
                <label className={`text-sm font-medium ${textSecondaryClass} block`}>
                  End Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className={`w-full px-4 py-3 rounded-lg border-2 transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      isDarkMode
                        ? 'bg-gray-700 border-gray-600 text-white focus:bg-gray-600'
                        : 'bg-white border-gray-300 text-gray-900 focus:bg-gray-50'
                    }`}
                  />
                </div>
              </div>
              
              {/* Apply Button */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-transparent block">Apply</label>
                <button
                  onClick={handleApplyCustomDates}
                  disabled={!customStartDate || !customEndDate}
                  className={`w-full px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2 ${
                    hasUnappliedChanges
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg transform hover:scale-105 animate-pulse'
                      : !customStartDate || !customEndDate
                      ? isDarkMode
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : isDarkMode
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  <Check className="h-4 w-4" />
                  <span>
                    {hasUnappliedChanges ? 'Apply Changes' : 'Applied'}
                  </span>
                </button>
              </div>
            </div>
            
            {/* Date Range Summary */}
            {customStartDate && customEndDate && (
              <div className={`mt-4 p-3 rounded-lg ${
                isDarkMode ? 'bg-gray-700/50' : 'bg-blue-100/50'
              }`}>
                <p className={`text-sm ${textSecondaryClass}`}>
                  Selected range: <span className={`font-medium ${textClass}`}>
                    {new Date(customStartDate).toLocaleDateString()} - {new Date(customEndDate).toLocaleDateString()}
                  </span>
                  {appliedCustomDates.start && appliedCustomDates.end && (
                    customStartDate === appliedCustomDates.start && customEndDate === appliedCustomDates.end
                      ? <span className={`ml-2 text-green-600 ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>✓ Applied</span>
                      : <span className={`ml-2 text-orange-600 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`}>⚠ Click Apply to update</span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`p-6 rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
          <h3 className={`text-lg font-semibold ${textClass} mb-4`}>Performance Metrics</h3>
          <div className="space-y-4">
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Overall Equipment Effectiveness (Availability × Performance × Quality)')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                OEE
                <Info className="h-3 w-3 ml-1" />
              </span>
              <div className="flex items-center space-x-2">
                <div className={`w-20 rounded-full h-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div 
                    className="bg-purple-500 h-2 rounded-full" 
                    style={{ width: `${stats.oee}%` }}
                  ></div>
                </div>
                <span className={`font-medium ${textClass}`}>
                  {stats.oee}%
                </span>
              </div>
            </div>
           
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Percentage of time the machine was available for production')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Availability
                <Info className="h-3 w-3 ml-1" />
              </span>
              <div className="flex items-center space-x-2">
                <div className={`w-20 rounded-full h-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div 
                    className="bg-green-500 h-2 rounded-full" 
                    style={{ width: `${stats.availability}%` }}
                  ></div>
                </div>
                <span className={`font-medium ${textClass}`}>{stats.availability}%</span>
              </div>
            </div>
            
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Actual production rate compared to the maximum possible rate')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Performance
                <Info className="h-3 w-3 ml-1" />
              </span>
              <div className="flex items-center space-x-2">
                <div className={`w-20 rounded-full h-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div 
                    className="bg-yellow-500 h-2 rounded-full" 
                    style={{ width: `${stats.performance}%` }}
                  ></div>
                </div>
                <span className={`font-medium ${textClass}`}>{stats.performance}%</span>
              </div>
            </div>

            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Percentage of units that meet quality standards')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Quality
                <Info className="h-3 w-3 ml-1" />
              </span>
              <div className="flex items-center space-x-2">
                <div className={`w-20 rounded-full h-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div 
                    className="bg-blue-500 h-2 rounded-full" 
                    style={{ width: `${stats.quality}%` }}
                  ></div>
                </div>
                <span className={`font-medium ${textClass}`}>{stats.quality}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className={`p-6 rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
          <h3 className={`text-lg font-semibold ${textClass} mb-4`}>Quality Metrics</h3>
          <div className="space-y-4">
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Units that passed quality inspection')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Good Units
                <Info className="h-3 w-3 ml-1" />
              </span>
              <span className={`font-medium ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                {stats.totalUnitsProduced - stats.totalDefectiveUnits}
              </span>
            </div>
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Units that failed quality inspection')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Defective Units
                <Info className="h-3 w-3 ml-1" />
              </span>
              <span className={`font-medium ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{stats.totalDefectiveUnits}</span>
            </div>
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Percentage of units that were defective')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Defect Rate
                <Info className="h-3 w-3 ml-1" />
              </span>
              <span className={`font-medium ${isDarkMode ? 'text-yellow-400' : 'text-amber-600'}`}>
                {stats.totalUnitsProduced > 0 
                  ? ((stats.totalDefectiveUnits / stats.totalUnitsProduced) * 100).toFixed(1)
                  : 0
                }%
              </span>
            </div>
          </div>
        </div>

        <div className={`p-6 rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
          <h3 className={`text-lg font-semibold ${textClass} mb-4`}>Reliability</h3>
          <div className="space-y-4">
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Current operational status of the machine')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Current Status
                <Info className="h-3 w-3 ml-1" />
              </span>
              <span className={`font-medium capitalize ${
                machine.status === 'running' 
                  ? isDarkMode ? 'text-green-400' : 'text-green-600' :
                machine.status === 'inactive' 
                  ? isDarkMode ? 'text-red-400' : 'text-red-600' :
                machine.status === 'stopped_yet_producing' 
                  ? isDarkMode ? 'text-orange-400' : 'text-orange-600' :
                  isDarkMode ? 'text-red-400' : 'text-red-600'
              }`}>
                {machine.status}
              </span>
            </div>
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Mean Time Between Failures in days (Year to Date)')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                MTBF
                <Info className="h-3 w-3 ml-1" />
              </span>

              <span className={`font-medium ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>{stats.mtbf > 0 ? (stats.mtbf / 1440).toFixed(1) : 0} days</span>
            </div>
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Mean Time To Repair in minutes (Year to Date)')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                MTTR
                <Info className="h-3 w-3 ml-1" />
              </span>
              <span className={`font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`}>{stats.mttr} minutes</span>
            </div>
            <div 
              className="flex justify-between items-center relative"
              onMouseEnter={handleMouseEnter('Total time the machine was running in the selected period')}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
            >
              <span className={`flex items-center ${textSecondaryClass}`}>
                Running Time
                <Info className="h-3 w-3 ml-1" />
              </span>
              <span className={`font-medium ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                {Math.round((stats.totalRunningMinutes || 0) / 60 * 10) / 10}h
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Production Timeline */}
      <div className={`rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
        <div className={`p-6 border-b ${cardBorderClass}`}>
          <h2 className={`text-lg font-semibold ${textClass}`}>Real-time Production Timeline</h2>
          <p className={`text-sm mt-1 ${textSecondaryClass}`}>
            Live production data with operator and mold information
          </p>
        </div>
        <div className="p-6">
          <ProductionTimeline 
            machineId={id!}
            onAddStoppage={handleAddStoppage}
            onUpdateProduction={handleUpdateProduction}
          />
        </div>
      </div>
    </div>
  );
};

export default MachineView;
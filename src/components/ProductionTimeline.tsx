import React, { useState, useEffect, useContext } from 'react';
import { useAuth } from '../context/AuthContext';
import { ProductionTimelineDay, User, Mold, StoppageRecord } from '../types';
import apiService from '../services/api';
import socketService from '../services/socket';
import { ThemeContext } from '../App';
import {
  Clock,
  User as UserIcon,
  Package,
  AlertTriangle,
  Play,
  Pause,
  Activity,
  Edit,
  Save,
  X,
  Plus,
  CheckCircle,
  XCircle,
  Calendar,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { toast } from 'react-toastify';

interface ProductionTimelineProps {
  machineId: string;
  onAddStoppage: (stoppage: any) => void;
  onUpdateProduction: (machineId: string, hour: number, date: string, data: any) => void;
}

const ProductionTimeline: React.FC<ProductionTimelineProps> = ({
  machineId,
  onAddStoppage,
  onUpdateProduction
}) => {
  const { user, isAdmin } = useAuth();
  const { isDarkMode } = useContext(ThemeContext);
  const [timeline, setTimeline] = useState<ProductionTimelineDay[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [molds, setMolds] = useState<Mold[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [editingCell, setEditingCell] = useState<{
    date: string;
    hour: number;
    field: 'operator' | 'mold' | 'defects';
  } | null>(null);
  const [editValues, setEditValues] = useState({
    operatorId: '',
    moldId: '',
    defectiveUnits: 0,
    applyToShift: false
  });
  const [showStoppageModal, setShowStoppageModal] = useState<{
    date: string;
    hour: number;
    pendingStoppageId?: string;
  } | null>(null);
  const [stoppageForm, setStoppageForm] = useState({
    reason: '',
    description: '',
    duration: 0,
    sapNotificationNumber: ''
  });
  const [currentPakistanTime, setCurrentPakistanTime] = useState(new Date());

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

  // Helper function to format date as YYYY-MM-DD in Pakistan time
  const formatPakistanDate = (date: Date) => {
    const PAKISTAN_OFFSET = 5 * 60 * 60 * 1000;
    const pakistanDate = new Date(date.getTime() + PAKISTAN_OFFSET);
    const year = pakistanDate.getUTCFullYear();
    const month = String(pakistanDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(pakistanDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Update Pakistan time every minute
  useEffect(() => {
    const updatePakistanTime = () => {
      const PAKISTAN_OFFSET = 5 * 60 * 60 * 1000;
      setCurrentPakistanTime(new Date(Date.now() + PAKISTAN_OFFSET));
    };

    updatePakistanTime();
    const timer = setInterval(updatePakistanTime, 60000);
    
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchTimelineData();
    fetchUsers();
    fetchMolds();
    setupSocketListeners();
  }, [machineId, selectedTimeframe, customStartDate, customEndDate]);

  const setupSocketListeners = () => {
    const handleProductionUpdate = (update: any) => {
      if (update.machineId === machineId) {
        setTimeline(prev => 
          prev.map(day => {
            if (day.date !== update.date) return day;
            return {
              ...day,
              hours: day.hours.map(hour => 
                hour.hour === update.hour 
                  ? { 
                      ...hour, 
                      unitsProduced: update.unitsProduced,
                      status: update.status,
                      runningMinutes: update.runningMinutes,
                      stoppageMinutes: update.stoppageMinutes
                    }
                  : hour
              )
            };
          })
        );
      }
    };

    const handleStoppageDetected = (stoppage: any) => {
      if (stoppage.machineId === machineId) {
        fetchTimelineData();
      }
    };

    const handleAssignmentUpdated = (update: any) => {
      if (update.machineId === machineId) {
        setTimeline(prev => 
          prev.map(day => {
            if (day.date !== update.date) return day;
            return {
              ...day,
              hours: day.hours.map(hour => {
                if (!update.hours.includes(hour.hour)) return hour;
                return {
                  ...hour,
                  operator: update.operatorId ? users.find(u => u._id === update.operatorId) : undefined,
                  mold: update.moldId ? molds.find(m => m._id === update.moldId) : undefined,
                  ...(hour.hour === update.originalHour && update.defectiveUnits !== undefined && {
                    defectiveUnits: update.defectiveUnits
                  })
                };
              })
            };
          })
        );
      }
    };

    socketService.on('production-update', handleProductionUpdate);
    socketService.on('unclassified-stoppage-detected', handleStoppageDetected);
    socketService.on('production-assignment-updated', handleAssignmentUpdated);
    socketService.on('stoppage-added', handleStoppageDetected);

    return () => {
      socketService.off('production-update', handleProductionUpdate);
      socketService.off('unclassified-stoppage-detected', handleStoppageDetected);
      socketService.off('production-assignment-updated', handleAssignmentUpdated);
      socketService.off('stoppage-added', handleStoppageDetected);
    };
  };

  const fetchTimelineData = async () => {
    try {
      setLoading(true);
      
      let params: any = { timeframe: selectedTimeframe };
      
      if (selectedTimeframe === 'custom') {
        if (!customStartDate || !customEndDate) {
          setLoading(false);
          return;
        }
        params = {
          timeframe: 'custom',
          startDate: customStartDate,
          endDate: customEndDate
        };
      }

      const data = await apiService.getProductionTimeline(machineId, params);
      setTimeline(data.timeline || []);
    } catch (err) {
      console.error('Failed to fetch timeline:', err);
      toast.error('Failed to fetch production timeline');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const usersData = await apiService.getUsers();
      setUsers(usersData);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  const fetchMolds = async () => {
    try {
      const moldsData = await apiService.getMolds();
      setMolds(moldsData);
    } catch (err) {
      console.error('Failed to fetch molds:', err);
    }
  };

  const handleCellEdit = (date: string, hour: number, field: 'operator' | 'mold' | 'defects') => {
    const dayData = timeline.find(d => d.date === date);
    const hourData = dayData?.hours.find(h => h.hour === hour);
    
    setEditingCell({ date, hour, field });
    setEditValues({
      operatorId: hourData?.operator?._id || '',
      moldId: hourData?.mold?._id || '',
      defectiveUnits: hourData?.defectiveUnits || 0,
      applyToShift: false
    });
  };

  const handleSaveEdit = async () => {
    if (!editingCell) return;

    try {
      const updateData: any = {};
      
      if (editingCell.field === 'operator') {
        updateData.operatorId = editValues.operatorId || null;
      } else if (editingCell.field === 'mold') {
        updateData.moldId = editValues.moldId || null;
      } else if (editingCell.field === 'defects') {
        updateData.defectiveUnits = editValues.defectiveUnits;
      }

      updateData.applyToShift = editValues.applyToShift;

      await onUpdateProduction(
        machineId,
        editingCell.hour,
        editingCell.date,
        updateData
      );

      setEditingCell(null);
    } catch (err) {
      console.error('Failed to save edit:', err);
    }
  };

  const handleAddStoppage = async () => {
    if (!showStoppageModal) return;

    try {
      const stoppageData = {
        ...stoppageForm,
        hour: showStoppageModal.hour,
        date: showStoppageModal.date,
        ...(showStoppageModal.pendingStoppageId && {
          pendingStoppageId: showStoppageModal.pendingStoppageId
        })
      };

      await onAddStoppage(stoppageData);
      setShowStoppageModal(null);
      setStoppageForm({
        reason: '',
        description: '',
        duration: 0,
        sapNotificationNumber: ''
      });
    } catch (err) {
      console.error('Failed to add stoppage:', err);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return isDarkMode ? 'bg-green-600' : 'bg-green-500';
      case 'stoppage': return isDarkMode ? 'bg-red-600' : 'bg-red-500';
      case 'inactive': return isDarkMode ? 'bg-gray-600' : 'bg-gray-400';
      default: return isDarkMode ? 'bg-gray-600' : 'bg-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Play className="h-3 w-3" />;
      case 'stoppage': return <Pause className="h-3 w-3" />;
      case 'inactive': return <Activity className="h-3 w-3" />;
      default: return <Activity className="h-3 w-3" />;
    }
  };

  const isCurrentHour = (date: string, hour: number) => {
    const today = formatPakistanDate(currentPakistanTime);
    const currentHour = currentPakistanTime.getUTCHours();
    return date === today && hour === currentHour;
  };

  const isPastHour = (date: string, hour: number) => {
    const today = formatPakistanDate(currentPakistanTime);
    const currentHour = currentPakistanTime.getUTCHours();
    
    if (date < today) return true;
    if (date === today && hour < currentHour) return true;
    return false;
  };

  const hasUnclassifiedStoppages = (hour: any) => {
    return hour.stoppages?.some((s: StoppageRecord) => s.reason === 'unclassified') || false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Timeframe Selector */}
      <div className="flex flex-col md:flex-row md:items-center space-y-2 md:space-y-0 md:space-x-4">
        <span className={`text-sm font-medium ${textSecondaryClass}`}>Timeline Period:</span>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'This Week' },
            { value: 'month', label: 'This Month' },
            { value: 'custom', label: 'Custom Range' }
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setSelectedTimeframe(option.value as any)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                selectedTimeframe === option.value
                  ? 'bg-blue-600 text-white'
                  : `${buttonSecondaryClass}`
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        
        {selectedTimeframe === 'custom' && (
          <div className="flex space-x-2">
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className={`px-3 py-1 text-sm rounded border ${inputBorderClass} ${inputBgClass} ${textClass}`}
            />
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className={`px-3 py-1 text-sm rounded border ${inputBorderClass} ${inputBgClass} ${textClass}`}
            />
          </div>
        )}
      </div>

      {/* Timeline Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-full">
          {timeline.map((day) => (
            <div key={day.date} className={`mb-6 rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
              <div className={`p-4 border-b ${cardBorderClass} flex items-center justify-between`}>
                <h3 className={`text-lg font-semibold ${textClass} flex items-center`}>
                  <Calendar className="h-5 w-5 mr-2" />
                  {new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </h3>
                <div className={`text-sm ${textSecondaryClass}`}>
                  {day.hours.reduce((sum, h) => sum + h.unitsProduced, 0)} units produced
                </div>
              </div>
              
              <div className="p-4">
                <div className="grid grid-cols-24 gap-1">
                  {day.hours.map((hour) => {
                    const isCurrent = isCurrentHour(day.date, hour.hour);
                    const isPast = isPastHour(day.date, hour.hour);
                    const hasUnclassified = hasUnclassifiedStoppages(hour);
                    
                    return (
                      <div
                        key={hour.hour}
                        className={`relative border rounded-lg p-2 min-h-[120px] transition-all duration-200 ${
                          isCurrent 
                            ? isDarkMode ? 'border-blue-500 bg-blue-900/20' : 'border-blue-500 bg-blue-50'
                            : cardBorderClass
                        } ${
                          hasUnclassified 
                            ? 'animate-pulse border-red-500' 
                            : ''
                        } hover:shadow-md`}
                      >
                        {/* Hour Header */}
                        <div className={`text-xs font-medium mb-2 flex items-center justify-between ${textSecondaryClass}`}>
                          <span>{hour.hour.toString().padStart(2, '0')}:00</span>
                          {isCurrent && (
                            <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse"></div>
                          )}
                        </div>

                        {/* Status Indicator */}
                        <div className={`flex items-center mb-2 text-xs`}>
                          <div className={`w-2 h-2 rounded-full mr-1 ${getStatusColor(hour.status)}`}></div>
                          <span className={`capitalize ${textSecondaryClass}`}>
                            {hour.status === 'running' ? 'Running' : 
                             hour.status === 'stoppage' ? 'Stoppage' : 'Inactive'}
                          </span>
                        </div>

                        {/* Production Count */}
                        <div className={`text-sm font-semibold mb-1 ${textClass}`}>
                          {hour.unitsProduced} units
                        </div>

                        {/* Defective Units - Editable */}
                        <div className="mb-2">
                          {editingCell?.date === day.date && 
                           editingCell?.hour === hour.hour && 
                           editingCell?.field === 'defects' ? (
                            <div className="space-y-1">
                              <input
                                type="number"
                                min="0"
                                value={editValues.defectiveUnits}
                                onChange={(e) => setEditValues({
                                  ...editValues,
                                  defectiveUnits: parseInt(e.target.value) || 0
                                })}
                                className={`w-full px-2 py-1 text-xs rounded border ${inputBorderClass} ${inputBgClass} ${textClass}`}
                              />
                              <div className="flex space-x-1">
                                <button
                                  onClick={handleSaveEdit}
                                  className="p-1 bg-green-600 text-white rounded text-xs"
                                >
                                  <Save className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => setEditingCell(null)}
                                  className="p-1 bg-gray-600 text-white rounded text-xs"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div 
                              className={`text-xs cursor-pointer hover:bg-gray-100 rounded p-1 ${
                                hour.defectiveUnits > 0 
                                  ? isDarkMode ? 'text-red-400' : 'text-red-600'
                                  : textSecondaryClass
                              }`}
                              onClick={() => handleCellEdit(day.date, hour.hour, 'defects')}
                            >
                              {hour.defectiveUnits > 0 ? `${hour.defectiveUnits} defects` : 'No defects'}
                            </div>
                          )}
                        </div>

                        {/* Operator Assignment - Editable */}
                        <div className="mb-2">
                          {editingCell?.date === day.date && 
                           editingCell?.hour === hour.hour && 
                           editingCell?.field === 'operator' ? (
                            <div className="space-y-1">
                              <select
                                value={editValues.operatorId}
                                onChange={(e) => setEditValues({
                                  ...editValues,
                                  operatorId: e.target.value
                                })}
                                className={`w-full px-2 py-1 text-xs rounded border ${inputBorderClass} ${inputBgClass} ${textClass}`}
                              >
                                <option value="">No operator</option>
                                {users.filter(u => u.role === 'operator').map(user => (
                                  <option key={user._id} value={user._id}>
                                    {user.username}
                                  </option>
                                ))}
                              </select>
                              <div className="flex items-center space-x-1">
                                <input
                                  type="checkbox"
                                  id={`shift-${day.date}-${hour.hour}`}
                                  checked={editValues.applyToShift}
                                  onChange={(e) => setEditValues({
                                    ...editValues,
                                    applyToShift: e.target.checked
                                  })}
                                  className="text-xs"
                                />
                                <label 
                                  htmlFor={`shift-${day.date}-${hour.hour}`}
                                  className={`text-xs ${textSecondaryClass}`}
                                >
                                  Apply to shift
                                </label>
                              </div>
                              <div className="flex space-x-1">
                                <button
                                  onClick={handleSaveEdit}
                                  className="p-1 bg-green-600 text-white rounded text-xs"
                                >
                                  <Save className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => setEditingCell(null)}
                                  className="p-1 bg-gray-600 text-white rounded text-xs"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div 
                              className={`text-xs cursor-pointer hover:bg-gray-100 rounded p-1 flex items-center ${
                                hour.operator 
                                  ? isDarkMode ? 'text-blue-400' : 'text-blue-600'
                                  : isPast 
                                    ? isDarkMode ? 'text-red-400' : 'text-red-600'
                                    : textSecondaryClass
                              }`}
                              onClick={() => handleCellEdit(day.date, hour.hour, 'operator')}
                            >
                              <UserIcon className="h-3 w-3 mr-1" />
                              {hour.operator ? hour.operator.username : 'No operator'}
                            </div>
                          )}
                        </div>

                        {/* Mold Assignment - Editable */}
                        <div className="mb-2">
                          {editingCell?.date === day.date && 
                           editingCell?.hour === hour.hour && 
                           editingCell?.field === 'mold' ? (
                            <div className="space-y-1">
                              <select
                                value={editValues.moldId}
                                onChange={(e) => setEditValues({
                                  ...editValues,
                                  moldId: e.target.value
                                })}
                                className={`w-full px-2 py-1 text-xs rounded border ${inputBorderClass} ${inputBgClass} ${textClass}`}
                              >
                                <option value="">No mold</option>
                                {molds.map(mold => (
                                  <option key={mold._id} value={mold._id}>
                                    {mold.name}
                                  </option>
                                ))}
                              </select>
                              <div className="flex items-center space-x-1">
                                <input
                                  type="checkbox"
                                  id={`mold-shift-${day.date}-${hour.hour}`}
                                  checked={editValues.applyToShift}
                                  onChange={(e) => setEditValues({
                                    ...editValues,
                                    applyToShift: e.target.checked
                                  })}
                                  className="text-xs"
                                />
                                <label 
                                  htmlFor={`mold-shift-${day.date}-${hour.hour}`}
                                  className={`text-xs ${textSecondaryClass}`}
                                >
                                  Apply to shift
                                </label>
                              </div>
                              <div className="flex space-x-1">
                                <button
                                  onClick={handleSaveEdit}
                                  className="p-1 bg-green-600 text-white rounded text-xs"
                                >
                                  <Save className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => setEditingCell(null)}
                                  className="p-1 bg-gray-600 text-white rounded text-xs"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div 
                              className={`text-xs cursor-pointer hover:bg-gray-100 rounded p-1 flex items-center ${
                                hour.mold 
                                  ? isDarkMode ? 'text-green-400' : 'text-green-600'
                                  : isPast 
                                    ? isDarkMode ? 'text-red-400' : 'text-red-600'
                                    : textSecondaryClass
                              }`}
                              onClick={() => handleCellEdit(day.date, hour.hour, 'mold')}
                            >
                              <Package className="h-3 w-3 mr-1" />
                              {hour.mold ? hour.mold.name : 'No mold'}
                            </div>
                          )}
                        </div>

                        {/* Stoppages */}
                        {hour.stoppages && hour.stoppages.length > 0 && (
                          <div className="space-y-1">
                            {hour.stoppages.map((stoppage, idx) => (
                              <div
                                key={idx}
                                className={`text-xs p-1 rounded flex items-center ${
                                  stoppage.reason === 'unclassified'
                                    ? isDarkMode ? 'bg-red-900/50 text-red-400' : 'bg-red-100 text-red-800'
                                    : isDarkMode ? 'bg-yellow-900/50 text-yellow-400' : 'bg-yellow-100 text-yellow-800'
                                }`}
                              >
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                <span className="truncate">
                                  {stoppage.reason === 'unclassified' ? 'Needs classification' : stoppage.reason}
                                  {stoppage.duration && ` (${stoppage.duration}m)`}
                                </span>
                                {stoppage.reason === 'unclassified' && (
                                  <button
                                    onClick={() => setShowStoppageModal({
                                      date: day.date,
                                      hour: hour.hour,
                                      pendingStoppageId: stoppage._id
                                    })}
                                    className="ml-1 p-0.5 bg-red-600 text-white rounded"
                                  >
                                    <Edit className="h-2 w-2" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Add Stoppage Button */}
                        <button
                          onClick={() => setShowStoppageModal({
                            date: day.date,
                            hour: hour.hour
                          })}
                          className={`mt-2 w-full text-xs py-1 rounded border border-dashed transition-colors ${
                            isDarkMode 
                              ? 'border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300' 
                              : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-700'
                          }`}
                        >
                          <Plus className="h-3 w-3 mx-auto" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stoppage Modal */}
      {showStoppageModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg border w-full max-w-md ${cardBgClass} ${cardBorderClass}`}>
            <div className={`p-6 border-b ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${textClass}`}>
                  {showStoppageModal.pendingStoppageId ? 'Classify Stoppage' : 'Add Stoppage'}
                </h3>
                <button 
                  onClick={() => setShowStoppageModal(null)}
                  className={textSecondaryClass}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                  Reason *
                </label>
                <select
                  value={stoppageForm.reason}
                  onChange={(e) => setStoppageForm({
                    ...stoppageForm,
                    reason: e.target.value,
                    sapNotificationNumber: e.target.value === 'breakdown' ? stoppageForm.sapNotificationNumber : ''
                  })}
                  className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  required
                >
                  <option value="">Select reason</option>
                  <option value="planned">Planned Maintenance</option>
                  <option value="mold_change">Mold Change</option>
                  <option value="breakdown">Breakdown</option>
                  <option value="maintenance">Unplanned Maintenance</option>
                  <option value="material_shortage">Material Shortage</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {stoppageForm.reason === 'breakdown' && (
                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    SAP Notification Number *
                  </label>
                  <input
                    type="text"
                    value={stoppageForm.sapNotificationNumber}
                    onChange={(e) => setStoppageForm({
                      ...stoppageForm,
                      sapNotificationNumber: e.target.value
                    })}
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter SAP notification number"
                    required
                  />
                </div>
              )}
              
              <div>
                <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                  Description
                </label>
                <textarea
                  value={stoppageForm.description}
                  onChange={(e) => setStoppageForm({
                    ...stoppageForm,
                    description: e.target.value
                  })}
                  className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  rows={3}
                  placeholder="Enter stoppage description"
                />
              </div>

              {!showStoppageModal.pendingStoppageId && (
                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Duration (minutes) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={stoppageForm.duration}
                    onChange={(e) => setStoppageForm({
                      ...stoppageForm,
                      duration: parseInt(e.target.value) || 0
                    })}
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    required
                  />
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowStoppageModal(null)}
                  className={`px-4 py-2 border ${buttonSecondaryClass} rounded-md`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddStoppage}
                  disabled={!stoppageForm.reason || (stoppageForm.reason === 'breakdown' && !stoppageForm.sapNotificationNumber)}
                  className={`px-4 py-2 ${buttonPrimaryClass} text-white rounded-md disabled:opacity-50`}
                >
                  {showStoppageModal.pendingStoppageId ? 'Classify' : 'Add'} Stoppage
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionTimeline;
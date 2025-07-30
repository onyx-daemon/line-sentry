import { useState, useEffect, useCallback, useContext } from 'react';
import { ProductionTimelineDay, ProductionHour, StoppageRecord, User, Mold } from '../types';
import { format, parseISO, isToday } from 'date-fns';
import socketService from '../services/socket';
import apiService from '../services/api';
import { 
  Clock, 
  User as UserIcon, 
  Wrench, 
  AlertTriangle, 
  X, 
  Plus,
  Play,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronLeft,
  ChevronRight,
  Zap,
  ZapOff
} from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../context/AuthContext';
import { ThemeContext } from '../App';

interface ProductionTimelineProps {
  data: ProductionTimelineDay[];
  machineId: string;
  onAddStoppage?: (stoppage: Partial<StoppageRecord>) => void;
  onUpdateProduction?: (machineId: string, hour: number, date: string, data: any) => void;
}

interface ProductionModalProps {
  isOpen: boolean;
  onClose: () => void;
  hour: ProductionHour;
  date: string;
  machineId: string;
  onAddStoppage?: (stoppage: Partial<StoppageRecord>) => void;
  onUpdateProduction?: (machineId: string, hour: number, date: string, data: any) => void;
  availableOperators?: User[];
  availableMolds?: Mold[];
  shifts: any[];
}

const ProductionModal: React.FC<ProductionModalProps> = ({
  isOpen,
  onClose,
  hour,
  date,
  machineId,
  onAddStoppage,
  onUpdateProduction,
  availableOperators = [],
  availableMolds = [],
  shifts = []
}) => {
  const { isDarkMode } = useContext(ThemeContext);
  const [activeTab, setActiveTab] = useState<'details' | 'stoppage' | 'assignment'>('details');
  const { user: currentUser } = useAuth();
  
  const [stoppageForm, setStoppageForm] = useState({
    reason: '',
    description: '',
    duration: 30,
    sapNotificationNumber: ''
  });
  const [assignmentForm, setAssignmentForm] = useState({
    operatorId: currentUser?.role === 'operator' 
    ? (currentUser.id || '')
    : (hour.operator?.id || ''),
  moldId: hour.mold?._id || '',
  defectiveUnits: hour.defectiveUnits || 0
  });
  const [applyToShift, setApplyToShift] = useState(false);
  const [shiftInfo, setShiftInfo] = useState<{name: string; hours: number[]} | null>(null);
  
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

  // Check for pending stoppages
  const pendingStoppage = hour.stoppages.find(s => s.reason === 'unclassified' || (s as any).isPending);

  useEffect(() => {
    if (pendingStoppage) {
      setActiveTab('stoppage');
      setStoppageForm({
        reason: '',
        description: '',
        duration: pendingStoppage.duration || 30,
        sapNotificationNumber: ''
      });
    }
  }, [pendingStoppage]);

  // Detect shift when hour changes
  useEffect(() => {
    if (shifts.length > 0 && hour) {
      // Find shift containing the current hour
      const currentShift = shifts.find(shift => {
        const startHour = parseInt(shift.startTime.split(':')[0]);
        const endHour = parseInt(shift.endTime.split(':')[0]);
        
        if (endHour > startHour) {
          return hour.hour >= startHour && hour.hour < endHour;
        } else {
          return hour.hour >= startHour || hour.hour < endHour;
        }
      });

      if (currentShift) {
        const startHour = parseInt(currentShift.startTime.split(':')[0]);
        const endHour = parseInt(currentShift.endTime.split(':')[0]);
        const shiftHours = [];

        if (startHour <= endHour) {
          for (let h = startHour; h < endHour; h++) {
            shiftHours.push(h);
          }
        } else {
          if (hour.hour >= startHour) {
            for (let h = startHour; h < 24; h++) shiftHours.push(h);
          } else if (hour.hour < endHour) {
            for (let h = 0; h < endHour; h++) shiftHours.push(h);
          }
        }

        setShiftInfo({
          name: currentShift.name,
          hours: shiftHours
        });
        setApplyToShift(false);
      } else {
        setShiftInfo(null);
        setApplyToShift(false);
      }
    }
  }, [shifts, hour]);

  if (!isOpen) return null;

  const handleStoppageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stoppageForm.reason.trim()) return;

    // Validate SAP notification number for breakdown
    if (stoppageForm.reason === 'breakdown') {
      if (!stoppageForm.sapNotificationNumber || stoppageForm.sapNotificationNumber.trim() === '') {
        toast.error('SAP notification number is required for breakdown stoppages');
        return;
      }
      if (!/^\d+$/.test(stoppageForm.sapNotificationNumber.trim())) {
        toast.error('SAP notification number must contain only numbers');
        return;
      }
    }
    try {
      const stoppageData = {
        machineId,
        hour: hour.hour,
        date,
        reason: stoppageForm.reason,
        description: stoppageForm.description.trim(),
        duration: stoppageForm.duration,
        ...(stoppageForm.reason === 'breakdown' && { sapNotificationNumber: stoppageForm.sapNotificationNumber }),
        ...(pendingStoppage && { pendingStoppageId: (pendingStoppage as any)._id })
      };

      await apiService.addStoppageRecord(stoppageData);
      
      setStoppageForm({ reason: '', description: '', duration: 30, sapNotificationNumber: '' });
      toast.success('Stoppage recorded successfully');
      onClose();
    } catch (error) {
      console.error('Failed to add stoppage:', error);
      toast.error('Failed to record stoppage');
    }

    socketService.emit('stoppage-updated', {
      machineId,
      date,
      hour: hour.hour
    });
  };

  const handleAssignmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const operatorId = assignmentForm.operatorId === '' ? null : assignmentForm.operatorId;
    const moldId = assignmentForm.moldId === '' ? null : assignmentForm.moldId;

    try {
      await apiService.updateProductionAssignment({
        machineId,
        hour: hour.hour,
        date,
        operatorId,
        moldId,
        defectiveUnits: assignmentForm.defectiveUnits,
        applyToShift: shiftInfo ? applyToShift : false
      });
      
      const message = applyToShift && shiftInfo 
        ? `Assignment updated for entire ${shiftInfo.name} shift` 
        : 'Assignment updated successfully';
      
      toast.success(message);
      onClose();
      
    } catch (error) {
      console.error('Failed to update assignment:', error);
      toast.error('Failed to update assignment');
    }

    

    socketService.emit('production-assignment-updated', {
      machineId,
      date,
      hours: applyToShift && shiftInfo ? shiftInfo.hours : [hour.hour],
      originalHour: hour.hour,
      operatorId: operatorId,
      moldId: moldId,
      defectiveUnits: assignmentForm.defectiveUnits
    });

  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return isDarkMode ? 'text-green-400' : 'text-green-600';
      case 'stoppage': return isDarkMode ? 'text-red-400' : 'text-red-600';
      case 'stopped_yet_producing': return isDarkMode ? 'text-orange-400' : 'text-orange-600';
      case 'inactive': return isDarkMode ? 'text-gray-400' : 'text-gray-600';
      default: return isDarkMode ? 'text-gray-400' : 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Play className="h-4 w-4" />;
      case 'stoppage': return <AlertTriangle className="h-4 w-4" />;
      case 'stopped_yet_producing': return <ZapOff className="h-4 w-4" />;
      case 'inactive': return <Activity className="h-4 w-4" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`rounded-lg border w-full max-w-2xl max-h-[90vh] overflow-y-auto ${cardBgClass} ${cardBorderClass}`}>
        <div className={`flex items-center justify-between p-6 border-b ${cardBorderClass}`}>
          <h3 className={`text-lg font-semibold ${textClass}`}>
            Production Details - {format(parseISO(date), 'MMM dd')}, {hour.hour.toString().padStart(2, '0')}:00
            {pendingStoppage && (
              <span className={`ml-2 text-sm animate-pulse ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                (Unclassified Stoppage - Needs Categorization)
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            className={textSecondaryClass}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`border-b ${cardBorderClass}`}>
          <nav className="flex space-x-8 px-6">
            {[
              { id: 'details', label: 'Details', icon: Activity },
              { id: 'assignment', label: 'Assignment', icon: UserIcon },
              { id: 'stoppage', label: pendingStoppage ? 'Categorize Stoppage' : 'Add Stoppage', icon: pendingStoppage ? AlertTriangle : Plus }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-2 py-3 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : `border-transparent ${textSecondaryClass} hover:${textClass}`
                } ${pendingStoppage && tab.id === 'stoppage' ? (isDarkMode ? 'text-red-400' : 'text-red-600') + ' animate-pulse' : ''}`}
              >
                <tab.icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Details Tab */}
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Production Summary */}
              <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                <h4 className={`text-sm font-medium ${textClass} mb-3`}>Production Summary</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <TrendingUp className={`h-5 w-5 ${isDarkMode ? 'text-green-400' : 'text-green-500'}`} />
                    </div>
                    <div className={`text-2xl font-bold ${textClass}`}>{hour.unitsProduced}</div>
                    <div className={`text-xs ${textSecondaryClass}`}>Units Produced</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <TrendingDown className={`h-5 w-5 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`} />
                    </div>
                    <div className={`text-2xl font-bold ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{hour.defectiveUnits}</div>
                    <div className={`text-xs ${textSecondaryClass}`}>Defective Units</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <div className={getStatusColor(hour.status)}>
                        {getStatusIcon(hour.status)}
                      </div>
                    </div>
                    <div className={`text-sm font-medium capitalize ${getStatusColor(hour.status)}`}>
                      {hour.status.replace('_', ' ')}
                    </div>
                    <div className={`text-xs ${textSecondaryClass}`}>Status</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-2">
                      <Activity className={`h-5 w-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
                    </div>
                    <div className={`text-2xl font-bold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {hour.unitsProduced > 0 ? ((hour.unitsProduced - hour.defectiveUnits) / hour.unitsProduced * 100).toFixed(1) : 0}%
                    </div>
                    <div className={`text-xs ${textSecondaryClass}`}>Quality Rate</div>
                  </div>
                </div>
              </div>

              {/* Time Distribution */}
              <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                <h4 className={`text-sm font-medium ${textClass} mb-3`}>Time Distribution</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className={`text-lg font-bold ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                      {Math.min(60, hour.runningMinutes || 0)}m
                    </div>
                    <div className={`text-xs ${textSecondaryClass}`}>Running Time</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                      {Math.min(60, hour.stoppageMinutes || 0)}m
                    </div>
                    <div className={`text-xs ${textSecondaryClass}`}>Stoppage Time</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-lg font-bold ${textSecondaryClass}`}>
                      {60 - Math.min(60, hour.runningMinutes || 0) - Math.min(60, hour.stoppageMinutes || 0)}m
                    </div>
                    <div className={`text-xs ${textSecondaryClass}`}>Inactive Time</div>
                  </div>
                </div>
                
                {/* Visual time bar */}
                <div className="mt-3 h-4 bg-gray-600 rounded-full overflow-hidden">
                  <div className="h-full flex">
                    <div 
                      className="bg-green-500" 
                      style={{ width: `${Math.min(100, ((hour.runningMinutes || 0) / 60) * 100)}%` }}
                    ></div>
                    <div 
                      className="bg-red-500" 
                      style={{ width: `${Math.min(100, ((hour.stoppageMinutes || 0) / 60) * 100)}%` }}
                    ></div>
                    <div 
                      className="bg-gray-500" 
                      style={{ width: `${Math.max(0, ((60 - (hour.runningMinutes || 0) - (hour.stoppageMinutes || 0)) / 60) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Assignment Information */}
              <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                <h4 className={`text-sm font-medium ${textClass} mb-3`}>Assignment Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center space-x-3">
                    <UserIcon className={`h-5 w-5 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
                    <div>
                      <div className={`text-sm ${textSecondaryClass}`}>Operator</div>
                      <div className={`font-medium ${textClass}`}>
                        {hour.operator?.username || 'Not assigned'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Wrench className={`h-5 w-5 ${isDarkMode ? 'text-purple-400' : 'text-purple-500'}`} />
                    <div>
                      <div className={`text-sm ${textSecondaryClass}`}>Mold</div>
                      <div className={`font-medium ${textClass}`}>
                        {hour.mold?.name || 'Not assigned'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stoppages */}
              {hour.stoppages.length > 0 && (
                <div className={`rounded-lg p-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  <h4 className={`text-sm font-medium ${textClass} mb-3`}>Stoppages</h4>
                  <div className="space-y-3">
                    {hour.stoppages.map((stoppage, index) => (
                      <div key={index} className={`rounded-lg p-3 ${
                        stoppage.reason === 'unclassified' || (stoppage as any).isPending 
                          ? isDarkMode 
                            ? 'bg-red-900/30 border border-red-500 animate-pulse' 
                            : 'bg-red-100 border border-red-300 animate-pulse'
                          : isDarkMode 
                            ? 'bg-gray-600' 
                            : 'bg-gray-200'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <AlertTriangle className={`h-4 w-4 ${
                              stoppage.reason === 'unclassified' || (stoppage as any).isPending 
                                ? isDarkMode 
                                  ? 'text-red-400' 
                                  : 'text-red-600'
                                : isDarkMode 
                                  ? 'text-red-400' 
                                  : 'text-red-600'
                            }`} />
                            <span className={`text-sm font-medium ${textClass} capitalize`}>
                              {stoppage.reason === 'unclassified' ? 'Pending Categorization' : stoppage.reason.replace('_', ' ')}
                            </span>
                          </div>
                          <span className={`text-xs ${textSecondaryClass}`}>
                            {stoppage.duration || 0} min
                          </span>
                        </div>
                        {stoppage.description && (
                          <p className={`text-xs ml-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{stoppage.description}</p>
                        )}
                        {(stoppage.reason === 'unclassified' || (stoppage as any).isPending) && (
                          <p className={`text-xs ml-6 mt-1 ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>
                            Click "Categorize Stoppage" tab to assign a reason
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Assignment Tab */}
          {activeTab === 'assignment' && (
            <form onSubmit={handleAssignmentSubmit} className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${textSecondaryClass}`}>
                  Operator
                </label>

                <select
                  value={assignmentForm.operatorId}
                  onChange={(e) => setAssignmentForm({...assignmentForm, operatorId: e.target.value})}
                  className={`w-full ${inputBgClass} border ${inputBorderClass} rounded-md px-3 py-2 ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="">No operator assigned</option>
                  {availableOperators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.username}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${textSecondaryClass}`}>
                  Mold
                </label>
                <select
                  value={assignmentForm.moldId}
                  onChange={(e) => setAssignmentForm({...assignmentForm, moldId: e.target.value})}
                  className={`w-full ${inputBgClass} border ${inputBorderClass} rounded-md px-3 py-2 ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="">No mold assigned</option>
                  {availableMolds.map((mold) => (
                    <option key={mold._id} value={mold._id}>
                      {mold.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${textSecondaryClass}`}>
                  Defective Units
                </label>
                <input
                  type="number"
                  min="0"
                  value={assignmentForm.defectiveUnits}
                  onChange={(e) => setAssignmentForm({...assignmentForm, defectiveUnits: parseInt(e.target.value) || 0})}
                  className={`w-full ${inputBgClass} border ${inputBorderClass} rounded-md px-3 py-2 ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
              </div>

              {/* Shift Assignment Section */}
              {shiftInfo && (
                <div className={`mt-4 p-3 rounded-lg border ${isDarkMode ? 'bg-gray-750 border-blue-500/30' : 'bg-blue-50 border-blue-300'}`}>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="applyToShift"
                      checked={applyToShift}
                      onChange={(e) => setApplyToShift(e.target.checked)}
                      className={`h-4 w-4 text-blue-600 rounded ${inputBorderClass} ${inputBgClass} focus:ring-blue-500`}
                    />
                    <label htmlFor="applyToShift" className={`ml-2 text-sm font-medium ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      Apply to entire shift ({shiftInfo.name})
                    </label>
                  </div>
                  
                  {applyToShift && (
                    <div className={`mt-2 text-xs ${textSecondaryClass}`}>
                      <p>This will apply operator and mold to:</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {shiftInfo.hours.map(h => (
                          <span 
                            key={h} 
                            className={`px-2 py-1 rounded ${
                              h === hour.hour 
                                ? 'bg-blue-600 text-white' 
                                : `${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`
                            }`}
                          >
                            {h.toString().padStart(2, '0')}:00
                          </span>
                        ))}
                      </div>
                      <p className={`mt-2 ${isDarkMode ? 'text-blue-300' : 'text-blue-600'}`}>
                        Note: Defective units will only be updated for the current hour ({hour.hour}:00)
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  type="submit"
                  className={`flex-1 py-2 px-4 rounded-md ${buttonPrimaryClass} text-white`}
                >
                  Update Assignment
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 ${buttonSecondaryClass} rounded-md`}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Stoppage Tab */}
          {activeTab === 'stoppage' && (
            <form onSubmit={handleStoppageSubmit} className="space-y-4">
              {pendingStoppage && (
                <div className={`rounded-lg p-4 mb-4 ${
                  isDarkMode ? 'bg-red-900/20 border border-red-500' : 'bg-red-100 border border-red-300'
                }`}>
                  <div className="flex items-center space-x-2 mb-2">
                    <AlertTriangle className={`h-5 w-5 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`} />
                    <h4 className={`font-medium ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>Unclassified Stoppage Detected</h4>
                  </div>
                  <p className={`text-sm ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                    An unclassified stoppage was automatically detected for {pendingStoppage.duration} minutes. 
                    Please categorize the reason for this stoppage.
                  </p>
                </div>
              )}

              <div>
                <label className={`block text-sm font-medium mb-2 ${textSecondaryClass}`}>
                  Stoppage Reason *
                </label>
                <select
                  required
                  value={stoppageForm.reason}
                  onChange={(e) => setStoppageForm({...stoppageForm, reason: e.target.value})}
                  className={`w-full ${inputBgClass} border ${inputBorderClass} rounded-md px-3 py-2 ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="">Select reason...</option>
                  <option value="planned">Planned Maintenance</option>
                  <option value="mold_change">Mold Change</option>
                  <option value="breakdown">Breakdown</option>
                  <option value="maintenance">Unplanned Maintenance</option>
                  <option value="material_shortage">Material Shortage</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {!pendingStoppage && (
                <div>
                  <label className={`block text-sm font-medium mb-2 ${textSecondaryClass}`}>
                    Duration (minutes) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="60"
                    value={stoppageForm.duration}
                    onChange={(e) => setStoppageForm({...stoppageForm, duration: parseInt(e.target.value) || 30})}
                    className={`w-full ${inputBgClass} border ${inputBorderClass} rounded-md px-3 py-2 ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
              )}

              <div>
                <label className={`block text-sm font-medium mb-2 ${textSecondaryClass}`}>
                  Description
                </label>
                <textarea
                  value={stoppageForm.description}
                  onChange={(e) => setStoppageForm({...stoppageForm, description: e.target.value})}
                  rows={3}
                  className={`w-full ${inputBgClass} border ${inputBorderClass} rounded-md px-3 py-2 ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  placeholder="Additional details about the stoppage..."
                />
              </div>

              {stoppageForm.reason === 'breakdown' && (
                <div>
                  <label className={`block text-sm font-medium mb-2 ${textSecondaryClass}`}>
                    SAP Notification Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={stoppageForm.sapNotificationNumber}
                    onChange={(e) => setStoppageForm({...stoppageForm, sapNotificationNumber: e.target.value})}
                    className={`w-full ${inputBgClass} border ${inputBorderClass} rounded-md px-3 py-2 ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter SAP notification number (numbers only)"
                    pattern="[0-9]*"
                  />
                  <p className={`text-xs mt-1 ${textSecondaryClass}`}>
                    Required for breakdown stoppages. Numbers only.
                  </p>
                </div>
              )}
              <div className="flex space-x-3 pt-4">
                <button
                  type="submit"
                  disabled={!stoppageForm.reason.trim()}
                  className={`flex-1 py-2 px-4 rounded-md ${isDarkMode ? 'bg-red-600 hover:bg-red-700' : 'bg-red-600 hover:bg-red-500'} text-white disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {pendingStoppage ? 'Categorize Stoppage' : 'Add Stoppage'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 ${buttonSecondaryClass} rounded-md`}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

const ProductionTimeline: React.FC<ProductionTimelineProps> = ({ 
  data: initialData, 
  machineId, 
  onAddStoppage, 
  onUpdateProduction,
}) => {
  const { isDarkMode } = useContext(ThemeContext);
  const [data, setData] = useState(initialData);
  const [selectedHour, setSelectedHour] = useState<{ hour: ProductionHour; date: string } | null>(null);
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [availableOperators, setAvailableOperators] = useState<User[]>([]);
  const [availableMolds, setAvailableMolds] = useState<Mold[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [machineStatus, setMachineStatus] = useState<string>('inactive');
  const [machineColor, setMachineColor] = useState<string>('gray');
  const [shifts, setShifts] = useState<any[]>([]);
  const { user: currentUser } = useAuth();

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

  const fetchOperatorsAndMolds = async () => {
      try {
        let operators: User[] = [];
        if (currentUser?.role === 'admin') {
          // For admin, fetch all operators
          operators = await apiService.getUsers();
        } else {
          // For operators, fetch only the current operator
          const operator = await apiService.getCurrentUser();
          operators = [operator];
        }
        
        // Filter to only operators
        operators = operators.filter(u => u.role === 'operator');
        
        // Fetch molds
        const molds = await apiService.getMolds();
        
        setAvailableOperators(operators);
        setAvailableMolds(molds);
        return {operators, molds};
      } catch (error) {
        console.error('Failed to fetch operators and molds:', error);
        return { operators: [], molds: [] };
      }
  };

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    
    return () => clearInterval(timer);
  }, []);

  // Update data when props change
  useEffect(() => {
    setData(initialData);
    // Auto-select today when data changes
    if (initialData.length > 0) {
      const todayIndex = initialData.findIndex(day => isToday(parseISO(day.date)));
      if (todayIndex >= 0) {
        setSelectedDayIndex(todayIndex);
      }
    }
  }, [initialData]);

  useEffect(() => {
    fetchOperatorsAndMolds();
  }, [currentUser]);

  // Set up socket listeners for real-time updates
  useEffect(() => {
    socketService.connect();
    socketService.joinMachine(machineId);

    const handleProductionUpdate = (update: any) => {
      if (update.machineId === machineId) {
        setData(prevData => {
          const newData = [...prevData];
          const dayIndex = newData.findIndex(day => day.date === update.date);
          
          if (dayIndex >= 0) {
            const hourIndex = newData[dayIndex].hours.findIndex(h => h.hour === update.hour);
            if (hourIndex >= 0) {
              newData[dayIndex].hours[hourIndex] = {
                ...newData[dayIndex].hours[hourIndex],
                unitsProduced: update.unitsProduced,
                status: update.status,
                runningMinutes: update.runningMinutes || newData[dayIndex].hours[hourIndex].runningMinutes,
                stoppageMinutes: update.stoppageMinutes || newData[dayIndex].hours[hourIndex].stoppageMinutes
              };
            }
          }
          return newData;
        });
      }
    };

    const handleRunningTimeUpdate = (update: any) => {
      if (update.machineId === machineId) {
        setData(prevData => {
          const newData = [...prevData];
          const dayIndex = newData.findIndex(day => day.date === update.date);
          
          if (dayIndex >= 0) {
            const hourIndex = newData[dayIndex].hours.findIndex(h => h.hour === update.hour);
            if (hourIndex >= 0) {
              newData[dayIndex].hours[hourIndex] = {
                ...newData[dayIndex].hours[hourIndex],
                runningMinutes: update.runningMinutes,
                status: 'running'
              };
            }
          }
          return newData;
        });
      }
    };

    const handleMachineStateUpdate = (update: any) => {
      if (update.machineId === machineId) {
        setMachineStatus(update.status);
        setMachineColor(update.color);
      }
    };

    const handleUnclassifiedStoppageDetected = (stoppage: any) => {
      if (stoppage.machineId === machineId) {
        setData(prevData => {
          const newData = [...prevData];
          const dayIndex = newData.findIndex(day => day.date === stoppage.date);
          
          if (dayIndex >= 0) {
            const hourIndex = newData[dayIndex].hours.findIndex(h => h.hour === stoppage.hour);
            if (hourIndex >= 0) {
              // Add unclassified stoppage
              const unclassifiedStoppageRecord: StoppageRecord = {
                _id: stoppage.pendingStoppageId || `unclassified_${Date.now()}`,
                reason: 'unclassified',
                description: 'Automatic stoppage detection - awaiting categorization',
                startTime: stoppage.stoppageStart,
                endTime: null,
                duration: stoppage.duration || 0
              };

              // Check if this unclassified stoppage already exists
              const existingIndex = newData[dayIndex].hours[hourIndex].stoppages.findIndex(
                s => s._id === stoppage.pendingStoppageId || s.reason === 'unclassified'
              );

              if (existingIndex === -1) {
                newData[dayIndex].hours[hourIndex].stoppages.push(unclassifiedStoppageRecord);
              }

              newData[dayIndex].hours[hourIndex].status = 'stoppage';
              newData[dayIndex].hours[hourIndex].stoppageMinutes = 
                (newData[dayIndex].hours[hourIndex].stoppageMinutes || 0) + (stoppage.duration || 0);
            }
          }
          
          return newData;
        });

        // Show toast notification
        toast.warning(`Unclassified stoppage detected - requires categorization`, {
          position: "top-right",
          autoClose: 5000,
          theme: isDarkMode ? "dark" : "light"
        });
      }
    };

    const handleStoppageAdded = (stoppage: any) => {
      if (stoppage.machineId === machineId) {
        // Update the timeline data in real-time
        setData(prevData => {
          const newData = [...prevData];
          const dayIndex = newData.findIndex(day => day.date === stoppage.date);
          
          if (dayIndex >= 0) {
            const hourIndex = newData[dayIndex].hours.findIndex(h => h.hour === stoppage.hour);
            if (hourIndex >= 0) {
              // Remove any unclassified stoppages and add the new classified one
              newData[dayIndex].hours[hourIndex].stoppages = 
                newData[dayIndex].hours[hourIndex].stoppages.filter(s => s.reason !== 'unclassified');
              
              // Add the new stoppage
              newData[dayIndex].hours[hourIndex].stoppages.push({
                _id: `stoppage_${Date.now()}`,
                reason: stoppage.stoppage.reason as any,
                description: stoppage.stoppage.description,
                startTime: new Date().toISOString(),
                endTime: null,
                duration: stoppage.stoppage.duration
              });

              // Update status based on stoppage reason
              if (stoppage.stoppage.reason === 'breakdown') {
                newData[dayIndex].hours[hourIndex].status = 'stoppage';
              } else {
                newData[dayIndex].hours[hourIndex].status = 'stoppage';
              }
            }

            newData[dayIndex].hours[hourIndex].stoppageMinutes = 
            newData[dayIndex].hours[hourIndex].stoppages.reduce(
              (sum, s) => sum + (s.duration || 0), 0
            );

          }

          return newData;
        });
      }
    };

    const handleProductionAssignmentUpdated = async (update: any) => {
    if (update.machineId === machineId) {
      try {
        // Get fresh operators/molds data
        const { operators, molds } = await fetchOperatorsAndMolds();
        
        setData(prevData => {
          const newData = [...prevData];
          const dayIndex = newData.findIndex(day => day.date === update.date);
          
          if (dayIndex >= 0) {
            update.hours.forEach((targetHour: number) => {
              let hourIndex = newData[dayIndex].hours.findIndex(h => h.hour === targetHour);

              if (hourIndex === -1) {
                const newHour: ProductionHour = {
                  hour: targetHour,
                  unitsProduced: 0,
                  defectiveUnits: 0,
                  status: 'inactive',
                  operator: undefined,
                  mold: undefined,
                  stoppages: [],
                  runningMinutes: 0,
                  stoppageMinutes: 0
                };
                newData[dayIndex].hours.push(newHour);
                hourIndex = newData[dayIndex].hours.length - 1;
              }

              if (hourIndex >= 0) {
                // Update operator using fresh data
                if (update.operatorId !== null) {
                  const operator = operators.find(op => op.id === update.operatorId);
                  newData[dayIndex].hours[hourIndex].operator = operator || undefined;
                } else {
                  newData[dayIndex].hours[hourIndex].operator = undefined;
                }
                
                // Update mold using fresh data
                if (update.moldId !== null) {
                  const mold = molds.find((m: any) => m._id === update.moldId);
                  newData[dayIndex].hours[hourIndex].mold = mold || undefined;
                } else {
                  newData[dayIndex].hours[hourIndex].mold = undefined;
                }
                
                // Update defects only for original hour
                if (targetHour === update.originalHour && update.defectiveUnits !== undefined) {
                  newData[dayIndex].hours[hourIndex].defectiveUnits = update.defectiveUnits;
                }
              }
            });
          }
          return newData;
        });
      } catch (error) {
        console.error('Failed to update assignment:', error);
      }
    }
    };

    const handleStoppageUpdated = (update: any) => {
      if (update.machineId === machineId) {
        setData(prevData => {
          const newData = [...prevData];
          const dayIndex = newData.findIndex(day => day.date === update.date);
          
          if (dayIndex >= 0) {
            const hourIndex = newData[dayIndex].hours.findIndex(h => h.hour === update.hour);
            if (hourIndex >= 0) {
              const stoppageIndex = newData[dayIndex].hours[hourIndex].stoppages.findIndex(
                s => s._id === update.stoppageId
              );
              
              if (stoppageIndex >= 0) {
                // Update duration AND startTime
                newData[dayIndex].hours[hourIndex].stoppages[stoppageIndex] = {
                  ...newData[dayIndex].hours[hourIndex].stoppages[stoppageIndex],
                  duration: update.duration,
                  startTime: new Date(Date.now() - update.duration * 60000).toISOString()
                };
                
                // Update total stoppage minutes
                newData[dayIndex].hours[hourIndex].stoppageMinutes = 
                  newData[dayIndex].hours[hourIndex].stoppages.reduce(
                    (sum, stoppage) => sum + (stoppage.duration || 0), 0
                  );
              }
            }
          }
          return newData;
        });
      }
    };

    socketService.on('production-update', handleProductionUpdate);
    socketService.on('running-time-update', handleRunningTimeUpdate);
    socketService.on('machine-state-update', handleMachineStateUpdate);
    socketService.on('unclassified-stoppage-detected', handleUnclassifiedStoppageDetected);
    socketService.on('stoppage-added', handleStoppageAdded);
    socketService.on('production-assignment-updated', handleProductionAssignmentUpdated);
    socketService.on('stoppage-updated', handleStoppageUpdated);

    return () => {
      socketService.off('production-update', handleProductionUpdate);
      socketService.off('running-time-update', handleRunningTimeUpdate);
      socketService.off('machine-state-update', handleMachineStateUpdate);
      socketService.off('unclassified-stoppage-detected', handleUnclassifiedStoppageDetected);
      socketService.off('stoppage-added', handleStoppageAdded);
      socketService.off('production-assignment-updated', handleProductionAssignmentUpdated);
      socketService.off('stoppage-updated', handleStoppageUpdated);
      socketService.leaveMachine(machineId);
    };
  }, [machineId, availableOperators, availableMolds]);

  // Fetch shifts
  useEffect(() => {
  const fetchShifts = async () => {
    try {
        const shifts = await apiService.getShifts();
        setShifts(shifts || []);
    } catch (error) {
      console.error('Failed to fetch shifts:', error);
    }
  };
  
  fetchShifts();
}, [currentUser]);

  // Filter data based on view mode and current time
   const getFilteredData = useCallback(() => {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    
    switch (viewMode) {
      case 'day':
        return initialData.filter(day => 
          new Date(day.date).toDateString() === todayUTC.toDateString()
        );
        
      case 'week':
        const startOfWeek = new Date(todayUTC);
        startOfWeek.setUTCDate(todayUTC.getUTCDate() - todayUTC.getUTCDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);
        
        return initialData.filter(day => {
          const dayDate = new Date(day.date);
          return dayDate >= startOfWeek && dayDate <= endOfWeek;
        });
        
      case 'month':
        const startOfMonth = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1));
        const endOfMonth = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth() + 1, 0));
        
        return initialData.filter(day => {
          const dayDate = new Date(day.date);
          return dayDate >= startOfMonth && dayDate <= endOfMonth;
        });
        
      default:
        return initialData;
    }
  }, [initialData, viewMode]);

  const filteredData = getFilteredData();
  const currentDay = filteredData[selectedDayIndex] || filteredData[0];

  const getHourColor = (hour: ProductionHour) => {
    // Map to the new 4 states
    let status: string = 'inactive';
    if (hour.status === 'running') status = 'running';
    else if (hour.status === 'stoppage') status = 'stoppage';
    else if (hour.status === 'stopped_yet_producing') status = 'stopped_yet_producing';
    
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'stoppage': return 'bg-red-600 animate-pulse';
      case 'stopped_yet_producing': return 'bg-orange-500';
      case 'inactive': 
      default: return 'bg-gray-600';
    }
  };

  const formatTime = (hour: number) => {
    return `${hour.toString().padStart(2, '0')}:00`;
  };

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className={`h-8 w-8 mx-auto mb-2 ${textSecondaryClass}`} />
        <p className={textSecondaryClass}>No production data available</p>
      </div>
    );
  }

  if (!currentDay) {
    return (
      <div className="text-center py-8">
        <Clock className={`h-8 w-8 mx-auto mb-2 ${textSecondaryClass}`} />
        <p className={textSecondaryClass}>No data available for selected period</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      {/* View Mode Selector */}
      <div className="flex items-center justify-between">
        <div className="flex space-x-1">
          {[
            { value: 'day', label: 'Today' },
            { value: 'week', label: 'This Week' },
            { value: 'month', label: 'This Month' }
          ].map((mode) => (
            <button
              key={mode.value}
              onClick={() => {
                setViewMode(mode.value as any);
                setSelectedDayIndex(0);
              }}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === mode.value
                  ? 'bg-blue-600 text-white'
                  : `${buttonSecondaryClass}`
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

         {/* Machine Status Indicator */}
        <div className={`flex items-center px-3 py-1 rounded-md ${
          machineColor === 'green'
            ? isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-800' 
            : machineColor === 'red'
            ? isDarkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-800'
            : machineColor === 'orange'
            ? isDarkMode ? 'bg-orange-900/30 text-orange-400' : 'bg-orange-100 text-orange-800'
            : isDarkMode ? 'bg-gray-900/30 text-gray-400' : 'bg-gray-100 text-gray-800'
        }`}>
          {machineColor === 'green' ? (
            <Zap className="h-4 w-4 mr-1" />
          ) : (
            <ZapOff className="h-4 w-4 mr-1" />
          )}
          <span className="text-sm">
            {machineStatus.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-green-500 rounded"></div>
            <span className={textClass}>Running</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-red-600 rounded animate-pulse"></div>
            <span className={textClass}>Stoppage</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-orange-500 rounded"></div>
            <span className={textClass}>Stopped Yet Producing</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-gray-500 rounded"></div>
            <span className={textClass}>Inactive</span>
          </div>
        </div>
      </div>

      {/* Day Navigation */}
      {filteredData.length > 1 && (
        <div className={`flex items-center justify-between rounded-lg p-3 border ${cardBgClass} ${cardBorderClass}`}>
          <button
            onClick={() => setSelectedDayIndex(Math.max(0, selectedDayIndex - 1))}
            disabled={selectedDayIndex === 0}
            className={`p-1 ${textSecondaryClass} hover:${textClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          
          <div className="text-center">
            <h3 className={`text-lg font-semibold ${textClass}`}>
              {format(parseISO(currentDay.date), 'EEEE, MMMM dd, yyyy')}
            </h3>
            <p className={`text-sm ${textSecondaryClass}`}>
              Total: {currentDay.hours.reduce((sum, h) => sum + h.unitsProduced, 0)} units • 
              Defects: {currentDay.hours.reduce((sum, h) => sum + h.defectiveUnits, 0)}
            </p>
          </div>
          
          <button
            onClick={() => setSelectedDayIndex(Math.min(filteredData.length - 1, selectedDayIndex + 1))}
            disabled={selectedDayIndex === filteredData.length - 1}
            className={`p-1 ${textSecondaryClass} hover:${textClass} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Compact Horizontal Timeline */}
      <div className={`rounded-lg border p-4 ${cardBgClass} ${cardBorderClass}`}>
        {/* Time Labels */}
        <div className={`flex mb-2 text-xs ${textSecondaryClass}`}>
          {currentDay.hours.map((hour) => (
            <div key={hour.hour} className="flex-1 text-center min-w-0">
              {formatTime(hour.hour)}
            </div>
          ))}
        </div>

        {/* Production Blocks */}
        <div className="flex gap-1 mb-3">
          {currentDay.hours.map((hour) => {
            const hasUnclassifiedStoppage = hour.stoppages.some(s => s.reason === 'unclassified');
            
            return (
              <div
                key={hour.hour}
                className="flex-1 relative group cursor-pointer min-w-0"
                onClick={() => setSelectedHour({ hour, date: currentDay.date })}
              >
                {/* Main production block with time-based visualization */}
                <div className={`h-12 rounded transition-all duration-200 group-hover:scale-105 border relative overflow-hidden ${
                  hasUnclassifiedStoppage ? isDarkMode ? 'border-red-500 border-2' : 'border-red-500 border-2' : `${cardBorderClass}`
                }`}>
                  {/* Time-based visualization with proper inactive time */}
                  {(() => {
                    const runningMinutes = hour.runningMinutes || 0;
                    const stoppageMinutes = hour.stoppageMinutes || 0;
                    const inactiveMinutes = 60 - runningMinutes - stoppageMinutes;
                    
                    return (
                      <>
                        {/* Running time visualization */}
                        <div
                          className="bg-green-500" 
                          style={{ 
                            width: `${((runningMinutes || 0) / 60) * 100}%`,
                            height: '100%',
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            opacity: 0.8
                          }}
                        />
                        
                        {/* Stoppage time visualization */}
                        <div
                          className={`${hasUnclassifiedStoppage ? 'bg-red-600 animate-pulse' : 'bg-red-500'}`}
                          style={{ 
                            width: `${((stoppageMinutes || 0) / 60) * 100}%`,
                            height: '100%',
                            position: 'absolute',
                            left: `${((runningMinutes || 0) / 60) * 100}%`,
                            top: 0,
                            opacity: hasUnclassifiedStoppage ? 1 : 0.8
                          }}
                        />
                        
                        {/* Inactive time (gray) */}
                        <div
                          className="bg-gray-500" 
                          style={{ 
                            width: `${((inactiveMinutes || 0) / 60) * 100}%`,
                            height: '100%',
                            position: 'absolute',
                            left: `${((runningMinutes + stoppageMinutes) / 60) * 100}%`,
                            top: 0,
                            opacity: 0.4
                          }}
                        />
                      </>
                    );
                  })()}
                  
                  {/* Units produced */} 
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={`text-xs font-bold text-white bg-black bg-opacity-60 px-1 rounded`}>
                      {hour.unitsProduced}
                    </span>
                  </div>

                  {/* Status indicators */}
                  <div className="absolute top-0 left-0 right-0 flex justify-between p-0.5">
                    {/* Operator indicator */}
                    {hour.operator && (
                      <div className="w-2 h-2 bg-blue-400 rounded-full" title="Operator assigned" />
                    )}
                    
                    {/* Defects indicator */}
                    {hour.defectiveUnits > 0 && (
                      <div className="w-2 h-2 bg-red-400 rounded-full" title={`${hour.defectiveUnits} defects`} />
                    )}
                  </div>

                  {/* Bottom indicators */}
                  <div className="absolute bottom-0 left-0 right-0 flex justify-between p-0.5">
                    {/* Mold indicator */}
                    {hour.mold && (
                      <div className="w-2 h-2 bg-purple-400 rounded-full" title="Mold assigned" />
                    )}
                    
                    {/* Stoppage indicator */}
                    {hour.stoppages.length > 0 && (
                      <div className={`w-2 h-2 rounded-full ${
                        hasUnclassifiedStoppage ? 'bg-red-600 animate-pulse' : 'bg-red-600'
                      }`} title={`${hour.stoppages.length} stoppages`} />
                    )}
                  </div>

                  {/* Unclassified stoppage overlay */}
                  {hasUnclassifiedStoppage && (
                    <div className={`absolute inset-0 animate-pulse border-2 rounded ${
                      isDarkMode ? 'bg-red-600 bg-opacity-20 border-red-500' : 'bg-red-200 border-red-500'
                    }`}>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <AlertTriangle className={`h-4 w-4 animate-bounce ${isDarkMode ? 'text-red-400' : 'text-red-600'}`} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Hover tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  <div className={`rounded-lg px-3 py-2 whitespace-nowrap border shadow-lg ${
                    isDarkMode ? 'bg-gray-900 text-white border-gray-600' : 'bg-white text-gray-900 border-gray-200'
                  }`}>
                    <div className="font-medium">{formatTime(hour.hour)}</div>
                    <div>Units: <span className={`${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>{hour.unitsProduced}</span></div>
                    {hour.defectiveUnits > 0 && (
                      <div>Defects: <span className={`${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{hour.defectiveUnits}</span></div>
                    )}
                    <div>Running: <span className={`${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>{hour.runningMinutes || 0}m</span></div>
                    <div>Stoppage: <span className={`${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{hour.stoppageMinutes || 0}m</span></div>
                    <div>Inactive: <span className={textSecondaryClass}>{60 - (hour.runningMinutes || 0) - (hour.stoppageMinutes || 0)}m</span></div>
                    {hour.operator && (
                      <div>Op: <span className={`${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>{hour.operator.username}</span></div>
                    )}
                    {hour.mold && (
                      <div>Mold: <span className={`${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`}>{hour.mold.name}</span></div>
                    )}
                    <div>Status: <span className="capitalize">{hour.status.replace('_', ' ')}</span></div>
                    {hour.stoppages.length > 0 && (
                      <div className="mt-1">
                        {hour.stoppages.map((stoppage, idx) => (
                          <div key={idx} className={`${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>
                            {stoppage.reason === 'unclassified' ? 'Unclassified' : stoppage.reason}: 
                            {stoppage.duration} min
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary Stats */}
        <div className={`grid grid-cols-4 gap-4 pt-3 border-t ${cardBorderClass}`}>
          <div className="text-center">
            <div className={`text-lg font-bold ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
              {currentDay.hours.reduce((sum, h) => sum + h.unitsProduced, 0)}
            </div>
            <div className={`text-xs ${textSecondaryClass}`}>Total Units</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
              {currentDay.hours.reduce((sum, h) => sum + h.defectiveUnits, 0)}
            </div>
            <div className={`text-xs ${textSecondaryClass}`}>Defects</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold ${isDarkMode ? 'text-yellow-400' : 'text-amber-600'}`}>
              {Math.round(currentDay.hours.reduce((sum, h) => sum + (h.runningMinutes || 0), 0) / 60 * 10) / 10}h
            </div>
            <div className={`text-xs ${textSecondaryClass}`}>Running</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
              {currentDay.hours.reduce((sum, h) => sum + h.stoppages.length, 0)}
            </div>
            <div className={`text-xs ${textSecondaryClass}`}>Stoppages</div>
          </div>
        </div>
      </div>

      {/* Week/Month Overview */}
      {viewMode !== 'day' && filteredData.length > 1 && (
        <div className={`rounded-lg border p-4 ${cardBgClass} ${cardBorderClass}`}>
          <h4 className={`text-sm font-medium ${textClass} mb-3`}>
            {viewMode === 'week' ? 'Week' : 'Month'} Overview
          </h4>
          <div className="space-y-2">
            {filteredData.map((day, index) => (
              <div 
                key={day.date} 
                className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                  index === selectedDayIndex 
                    ? isDarkMode 
                      ? 'bg-blue-600/20 border border-blue-500/30' 
                      : 'bg-blue-100 border border-blue-300'
                    : isDarkMode 
                      ? 'hover:bg-gray-700' 
                      : 'hover:bg-gray-100'
                }`}
                onClick={() => setSelectedDayIndex(index)}
              >
                <div className={`text-sm ${textClass}`}>
                  {format(parseISO(day.date), 'MMM dd')}
                  {isToday(parseISO(day.date)) && (
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                      isDarkMode ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'
                    }`}>Today</span>
                  )}
                </div>
                <div className="flex items-center space-x-4 text-xs">
                  <span className={isDarkMode ? 'text-green-400' : 'text-green-600'}>
                    {day.hours.reduce((sum, h) => sum + h.unitsProduced, 0)} units
                  </span>
                  <span className={isDarkMode ? 'text-red-400' : 'text-red-600'}>
                    {day.hours.reduce((sum, h) => sum + h.defectiveUnits, 0)} defects
                  </span>
                  <span className={isDarkMode ? 'text-yellow-400' : 'text-amber-600'}>
                    {Math.round(day.hours.reduce((sum, h) => sum + (h.runningMinutes || 0), 0) / 60 * 10) / 10}h running
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Production Modal */}
      {selectedHour && (
        <ProductionModal
          key={`${selectedHour.date}-${selectedHour.hour.hour}`}
          isOpen={true}
          onClose={() => setSelectedHour(null)}
          hour={selectedHour.hour}
          date={selectedHour.date}
          machineId={machineId}
          onAddStoppage={onAddStoppage}
          onUpdateProduction={onUpdateProduction}
          availableOperators={availableOperators}
          availableMolds={availableMolds}
          shifts={shifts}
        />
      )}
    </div>
  );
};

export default ProductionTimeline;
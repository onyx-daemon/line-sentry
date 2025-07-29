import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mold, Department } from '../types';
import apiService from '../services/api';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Power, 
  PowerOff,
  Search,
  Loader,
  PackageOpen
} from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const Molds: React.FC = () => {
  const { isAdmin } = useAuth();
  const [molds, setMolds] = useState<Mold[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingMold, setEditingMold] = useState<Mold | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    productionCapacityPerHour: 0,
    departmentId: '',
    isActive: true
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [moldsData, departmentsData] = await Promise.all([
        apiService.getAllMolds(),
        apiService.getDepartments()
      ]);
      
      // Enrich molds with department names
      const enrichedMolds = moldsData.map((mold: Mold) => {
        if (typeof mold.departmentId === 'string') {
          const department = departmentsData.find((d: Department) => d._id === mold.departmentId);
          return {
            ...mold,
            departmentId: department 
              ? { _id: department._id, name: department.name } 
              : { _id: mold.departmentId, name: 'Unknown' }
          };
        }
        return mold;
      });
      
      setMolds(enrichedMolds);
      setDepartments(departmentsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch data';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // Helper to get department name
  const getDepartmentName = (mold: Mold) => {
    if (typeof mold.departmentId === 'object') {
      return mold.departmentId.name;
    }
    const department = departments.find(d => d._id === mold.departmentId);
    return department ? department.name : 'Unknown';
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const filteredMolds = molds.filter(mold => {
    const lowerSearch = searchTerm.toLowerCase();
    const deptName = getDepartmentName(mold).toLowerCase();
    
    return (
      mold.name.toLowerCase().includes(lowerSearch) ||
      (mold.description && mold.description.toLowerCase().includes(lowerSearch)) ||
      deptName.includes(lowerSearch) ||
      mold.productionCapacityPerHour.toString().includes(lowerSearch)
    );
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (editingMold) {
      setEditingMold({ ...editingMold, [name]: value });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value);
    if (editingMold) {
      setEditingMold({ ...editingMold, [name]: numValue });
    } else {
      setFormData({ ...formData, [name]: numValue });
    }
  };

  const handleToggleStatus = async (id: string, isActive: boolean) => {
    try {
      setStatusTogglingId(id);
      await apiService.toggleMoldStatus(id);
      setMolds(molds.map(mold => 
        mold._id === id ? { ...mold, isActive: !isActive } : mold
      ));
      toast.success(`Mold ${!isActive ? 'activated' : 'deactivated'} successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle mold status';
      toast.error(message);
    } finally {
      setStatusTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this mold? This action cannot be undone.')) return;

    try {
      setDeletingId(id);
      await apiService.deleteMold(id);
      setMolds(molds.filter(mold => mold._id !== id));
      toast.success('Mold deleted successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete mold';
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateMold = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const newMold = await apiService.createMold(formData);
      
      // Find department name from stored departments
      const department = departments.find(d => d._id === formData.departmentId);
      
      // Create enhanced mold object with department name
      const enhancedMold = {
        ...newMold,
        departmentId: {
          _id: newMold.departmentId,
          name: department?.name || 'Unknown'
        }
      };

      setMolds([...molds, enhancedMold]);
      setIsCreating(false);
      setFormData({
        name: '',
        description: '',
        productionCapacityPerHour: 0,
        departmentId: '',
        isActive: true
      });
      toast.success('Mold created successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create mold';
      toast.error(message);
    }
  };

  const handleUpdateMold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMold) return;
    
    try {
      const updatedMold = await apiService.updateMold(editingMold._id, editingMold);
      
      // Find department name from stored departments
      const department = departments.find(d => d._id === editingMold.departmentId);
      
      // Create enhanced mold object with department name
      const enhancedMold = {
        ...updatedMold,
        departmentId: {
          _id: updatedMold.departmentId,
          name: department?.name || 'Unknown'
        }
      };

      setMolds(molds.map(mold => 
        mold._id === editingMold._id ? enhancedMold : mold
      ));
      setEditingMold(null);
      toast.success('Mold updated successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update mold';
      toast.error(message);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded-md">
        <div className="flex items-center">
          <div className="h-4 w-4 mr-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
            </svg>
          </div>
          <span>Access denied. Admin privileges required.</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
        theme="dark"
      />
      
      {/* Header - Matches Departments */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <PackageOpen className="h-8 w-8 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Molds</h1>
            <p className="text-gray-400">Manage and configure production molds</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search molds..."
              className="pl-10 pr-4 py-2 w-full bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={searchTerm}
              onChange={handleSearch}
            />
          </div>
          
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            <Plus className="h-5 w-5" />
            <span>New Mold</span>
          </button>
        </div>
      </div>

      {/* Stats - Matches Departments */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Molds</p>
              <p className="text-xl font-semibold text-white">{molds.length}</p>
            </div>
            <PackageOpen className="h-8 w-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Active Molds</p>
              <p className="text-xl font-semibold text-green-400">
                {molds.filter(m => m.isActive).length}
              </p>
            </div>
            <Power className="h-8 w-8 text-green-400" />
          </div>
        </div>

        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Inactive Molds</p>
              <p className="text-xl font-semibold text-red-400">
                {molds.filter(m => !m.isActive).length}
              </p>
            </div>
            <PowerOff className="h-8 w-8 text-red-400" />
          </div>
        </div>
      </div>

      {/* Create Mold Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-md">
            <div className="p-6 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Create New Mold</h3>
                <button 
                  onClick={() => setIsCreating(false)}
                  className="text-gray-400 hover:text-white"
                >
                  &times;
                </button>
              </div>
            </div>
            
            <form onSubmit={handleCreateMold} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Mold Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter mold name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter mold description"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Production Capacity (units/hour) *
                </label>
                <input
                  type="number"
                  name="productionCapacityPerHour"
                  required
                  min="1"
                  value={formData.productionCapacityPerHour}
                  onChange={handleNumberInputChange}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter production capacity"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Department *
                </label>
                <select
                  name="departmentId"
                  required
                  value={formData.departmentId}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select department</option>
                  {departments.map((dept) => (
                    <option key={dept._id} value={dept._id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Active Status
                </label>
                <div className="flex items-center">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      name="isActive"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="ml-3 text-sm text-gray-300">
                      {formData.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 border border-gray-600 text-gray-300 rounded-md hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Create Mold
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Mold Modal */}
      {editingMold && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-md">
            <div className="p-6 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Edit Mold</h3>
                <button 
                  onClick={() => setEditingMold(null)}
                  className="text-gray-400 hover:text-white"
                >
                  &times;
                </button>
              </div>
            </div>
            
            <form onSubmit={handleUpdateMold} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Mold Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value={editingMold.name}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter mold name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  name="description"
                  value={editingMold.description || ''}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter mold description"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Production Capacity (units/hour) *
                </label>
                <input
                  type="number"
                  name="productionCapacityPerHour"
                  required
                  min="1"
                  value={editingMold.productionCapacityPerHour}
                  onChange={handleNumberInputChange}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter production capacity"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Department *
                </label>
                <select
                  name="departmentId"
                  required
                  value={typeof editingMold.departmentId === 'string' 
                    ? editingMold.departmentId 
                    : editingMold.departmentId._id}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select department</option>
                  {departments.map((dept) => (
                    <option key={dept._id} value={dept._id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Active Status
                </label>
                <div className="flex items-center">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      name="isActive"
                      checked={editingMold.isActive}
                      onChange={(e) => setEditingMold({ ...editingMold, isActive: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="ml-3 text-sm text-gray-300">
                      {editingMold.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </div>
              </div>
              
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingMold(null)}
                  className="px-4 py-2 border border-gray-600 text-gray-300 rounded-md hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Update Mold
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Molds Table - Matches Departments */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-750">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Mold
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Description
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Department
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Capacity
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Status
                </th>
                {isAdmin && (
                  <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-gray-800 divide-y divide-gray-700">
              {filteredMolds.length > 0 ? (
                filteredMolds.map((mold) => (
                  <tr 
                    key={mold._id} 
                    className={`hover:bg-gray-750 ${!mold.isActive ? 'opacity-70' : ''}`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className={`flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${
                          mold.isActive ? 'bg-blue-500' : 'bg-gray-600'
                        }`}>
                          <PackageOpen className="h-6 w-6 text-white" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-white">
                            {mold.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-300 max-w-md truncate">
                        {mold.description || 'No description'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-300">
                        {getDepartmentName(mold)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {mold.productionCapacityPerHour} units/hour
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        mold.isActive 
                          ? 'bg-green-900/50 text-green-400' 
                          : 'bg-red-900/50 text-red-400'
                      }`}>
                        {mold.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => {
                              setEditingMold({
                                ...mold,
                                departmentId: typeof mold.departmentId === 'object' 
                                  ? mold.departmentId._id 
                                  : mold.departmentId
                              });
                            }}
                            className="text-blue-400 hover:text-blue-300 p-1 rounded-md hover:bg-gray-700"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(mold._id, mold.isActive)}
                            disabled={statusTogglingId === mold._id}
                            className={`p-1 rounded-md hover:bg-gray-700 ${
                              mold.isActive 
                                ? 'text-yellow-400 hover:text-yellow-300' 
                                : 'text-green-400 hover:text-green-300'
                            } ${statusTogglingId === mold._id ? 'opacity-50' : ''}`}
                            title={mold.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {statusTogglingId === mold._id ? (
                              <Loader className="h-4 w-4 animate-spin" />
                            ) : mold.isActive ? (
                              <PowerOff className="h-4 w-4" />
                            ) : (
                              <Power className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(mold._id)}
                            disabled={deletingId === mold._id}
                            className={`text-red-400 hover:text-red-300 p-1 rounded-md hover:bg-gray-700 ${
                              deletingId === mold._id ? 'opacity-50' : ''
                            }`}
                            title="Delete"
                          >
                            {deletingId === mold._id ? (
                              <Loader className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <PackageOpen className="h-12 w-12 text-gray-600 mb-4" />
                      <h3 className="text-lg font-medium text-gray-400 mb-2">No molds found</h3>
                      <p className="text-gray-500 max-w-md">
                        {searchTerm 
                          ? `No molds match your search for "${searchTerm}"` 
                          : 'Get started by creating your first mold'}
                      </p>
                      {isAdmin && !searchTerm && (
                        <button 
                          onClick={() => setIsCreating(true)}
                          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                        >
                          Create Mold
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Molds;
import React, { useState, useEffect, useCallback, useContext } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
  PackageOpen,
  Filter,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ThemeContext } from '../App';

interface PaginationData {
  currentPage: number;
  totalPages: number;
  totalMolds: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextPage: number | null;
  prevPage: number | null;
}

interface MoldsResponse {
  molds: Mold[];
  pagination: PaginationData;
  filters: {
    search: string;
    department: string;
    isActive: string;
    sortBy: string;
    sortOrder: string;
  };
}

// Zod schemas
const moldSchema = z.object({
  name: z.string()
    .min(3, "Name must be at least 3 characters")
    .max(50, "Name cannot exceed 50 characters"),
  description: z.string()
    .max(200, "Description cannot exceed 200 characters")
    .optional(),
  productionCapacityPerHour: z.number()
    .min(1, "Capacity must be at least 1 unit/hour")
    .positive("Capacity must be a positive number"),
  departmentId: z.string().nonempty("Department is required"),
  isActive: z.boolean().default(true).optional()
});

type MoldFormData = z.infer<typeof moldSchema>;

const Molds: React.FC = () => {
  const { isAdmin } = useAuth();
  const { isDarkMode } = useContext(ThemeContext);
  const [moldsData, setMoldsData] = useState<MoldsResponse | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Pagination and filtering states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [showFilters, setShowFilters] = useState(false);
  
  // Modal states
  const [isCreating, setIsCreating] = useState(false);
  const [editingMold, setEditingMold] = useState<Mold | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);

  // Debounced search
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  // Theme classes
  const bgClass = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBgClass = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const cardBorderClass = isDarkMode ? 'border-gray-700' : 'border-gray-200';
  const textClass = isDarkMode ? 'text-white' : 'text-gray-900';
  const textSecondaryClass = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const inputBgClass = isDarkMode ? 'bg-gray-700' : 'bg-white';
  const inputBorderClass = isDarkMode ? 'border-gray-600' : 'border-gray-300';
  const tableHeaderClass = isDarkMode ? 'bg-gray-750' : 'bg-gray-50';
  const tableRowHoverClass = isDarkMode ? 'hover:bg-gray-750' : 'hover:bg-gray-50';
  const buttonPrimaryClass = isDarkMode 
    ? 'bg-blue-600 hover:bg-blue-700' 
    : 'bg-blue-600 hover:bg-blue-700';
  const buttonSecondaryClass = isDarkMode 
    ? 'border-gray-600 text-gray-300 hover:bg-gray-700' 
    : 'border-gray-300 text-gray-700 hover:bg-gray-50';
  const errorClass = isDarkMode ? 'text-red-400' : 'text-red-600';

  // React Hook Form
  const createFormMethods = useForm<MoldFormData>({
    resolver: zodResolver(moldSchema),
    defaultValues: {
      name: '',
      description: '',
      productionCapacityPerHour: 0,
      departmentId: '',
      isActive: true
    }
  });

  const editFormMethods = useForm<MoldFormData>({
    resolver: zodResolver(moldSchema),
    defaultValues: {
      name: '',
      description: '',
      productionCapacityPerHour: 0,
      departmentId: '',
      isActive: true
    }
  });

  // Reset forms when modals open/close
  useEffect(() => {
    if (isCreating) {
      createFormMethods.reset();
    }
  }, [isCreating]);

  useEffect(() => {
    if (editingMold) {
      editFormMethods.reset({
        ...editingMold,
        departmentId: typeof editingMold.departmentId === 'object' 
          ? editingMold.departmentId._id 
          : editingMold.departmentId
      });
    }
  }, [editingMold]);

  const fetchData = useCallback(async (page = 1, search = '', department = '', isActive = '') => {
    try {
      setLoading(true);
      
      const params = {
        page,
        limit: pageSize,
        sortBy,
        sortOrder,
        ...(search && { search }),
        ...(department && { department }),
        ...(isActive !== '' && { isActive })
      };

      const [moldsResponse, departmentsData] = await Promise.all([
        apiService.getMoldsAdmin(params),
        apiService.getDepartments()
      ]);
      
      // Enrich molds with department names
      const enrichedMolds = moldsResponse.molds.map((mold: Mold) => {
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
      
      setMoldsData({
        ...moldsResponse,
        molds: enrichedMolds
      });
      setDepartments(departmentsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch data';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [pageSize, sortBy, sortOrder]);

  // Debounced search effect
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const timeout = setTimeout(() => {
      if (searchTerm !== (moldsData?.filters.search || '')) {
        fetchData(1, searchTerm, departmentFilter, statusFilter);
      }
    }, 500);

    setSearchTimeout(timeout);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [searchTerm]);

  useEffect(() => {
    fetchData(1, searchTerm, departmentFilter, statusFilter);
  }, [fetchData, departmentFilter, statusFilter, sortBy, sortOrder]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && moldsData && page <= moldsData.pagination.totalPages) {
      fetchData(page, searchTerm, departmentFilter, statusFilter);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    fetchData(1, searchTerm, departmentFilter, statusFilter);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setDepartmentFilter('');
    setStatusFilter('');
    setSortBy('name');
    setSortOrder('asc');
    setCurrentPage(1);
  };

  const handleToggleStatus = async (id: string, isActive: boolean) => {
    try {
      setStatusTogglingId(id);
      await apiService.toggleMoldStatus(id);
      toast.success(`Mold ${!isActive ? 'activated' : 'deactivated'} successfully`);
      
      // Refresh the current page
      fetchData(currentPage, searchTerm, departmentFilter, statusFilter);
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
      toast.success('Mold deleted successfully');
      
      // If we're on the last page and it becomes empty, go to previous page
      if (moldsData && moldsData.molds.length === 1 && currentPage > 1) {
        fetchData(currentPage - 1, searchTerm, departmentFilter, statusFilter);
      } else {
        fetchData(currentPage, searchTerm, departmentFilter, statusFilter);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete mold';
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateMold = createFormMethods.handleSubmit(async (formData) => {
    try {
      await apiService.createMold(formData);
      toast.success('Mold created successfully');
      
      // Refresh the current page
      fetchData(currentPage, searchTerm, departmentFilter, statusFilter);
      setIsCreating(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create mold';
      toast.error(message);
    }
  });

  const handleUpdateMold = editFormMethods.handleSubmit(async (formData) => {
    if (!editingMold) return;
    
    try {
      await apiService.updateMold(editingMold._id, formData);
      toast.success('Mold updated successfully');
      
      // Refresh the current page
      fetchData(currentPage, searchTerm, departmentFilter, statusFilter);
      setEditingMold(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update mold';
      toast.error(message);
    }
  });

  const getDepartmentName = (mold: Mold) => {
    if (typeof mold.departmentId === 'object') {
      return mold.departmentId.name;
    }
    const department = departments.find(d => d._id === mold.departmentId);
    return department ? department.name : 'Unknown';
  };

  const Pagination = ({ pagination }: { pagination: PaginationData }) => {
    if (pagination.totalPages <= 1) return null;

    const getPageNumbers = () => {
      const pages = [];
      const maxVisible = 5;
      let start = Math.max(1, pagination.currentPage - Math.floor(maxVisible / 2));
      let end = Math.min(pagination.totalPages, start + maxVisible - 1);
      
      if (end - start + 1 < maxVisible) {
        start = Math.max(1, end - maxVisible + 1);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      return pages;
    };

    const paginationBgClass = isDarkMode ? 'bg-gray-800' : 'bg-gray-50';
    const paginationBorderClass = isDarkMode ? 'border-gray-700' : 'border-gray-200';
    const paginationTextClass = isDarkMode ? 'text-gray-400' : 'text-gray-500';
    const paginationButtonClass = isDarkMode ? 'bg-gray-700 text-white' : 'bg-white text-gray-700';
    const paginationHoverClass = isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100';

    return (
      <div className={`flex items-center justify-between px-6 py-3 ${paginationBgClass} border-t ${paginationBorderClass}`}>
        <div className={`flex items-center text-sm ${paginationTextClass}`}>
          Showing {((pagination.currentPage - 1) * pagination.limit) + 1} to{' '}
          {Math.min(pagination.currentPage * pagination.limit, pagination.totalMolds)} of{' '}
          {pagination.totalMolds} results
        </div>
        
        <div className="flex items-center space-x-2">
          <select
            value={pageSize}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            className={`px-2 py-1 ${paginationButtonClass} border ${inputBorderClass} rounded text-sm`}
          >
            <option value={5}>5 per page</option>
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
          </select>
          
          <button
            onClick={() => handlePageChange(pagination.currentPage - 1)}
            disabled={!pagination.hasPrevPage}
            className={`p-2 ${paginationTextClass} hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          
          {getPageNumbers().map(page => (
            <button
              key={page}
              onClick={() => handlePageChange(page)}
              className={`px-3 py-1 rounded text-sm ${
                page === pagination.currentPage
                  ? 'bg-blue-600 text-white'
                  : `${paginationButtonClass} ${paginationHoverClass} ${paginationTextClass}`
              }`}
            >
              {page}
            </button>
          ))}
          
          <button
            onClick={() => handlePageChange(pagination.currentPage + 1)}
            disabled={!pagination.hasNextPage}
            className={`p-2 ${paginationTextClass} hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  if (!isAdmin) {
    return (
      <div className={`${isDarkMode ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-800'} border ${isDarkMode ? 'border-red-500' : 'border-red-300'} px-4 py-3 rounded-md`}>
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

  const molds = moldsData?.molds || [];
  const pagination = moldsData?.pagination;

  return (
    <div className={`space-y-6 ${bgClass} min-h-screen p-4`}>
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
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <PackageOpen className={`h-8 w-8 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
          <div>
            <h1 className={`text-2xl font-bold ${textClass}`}>Molds</h1>
            <p className={textSecondaryClass}>Manage and configure production molds</p>
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
              className={`pl-10 pr-4 py-2 w-full ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {loading && (
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                <Loader className="h-4 w-4 animate-spin text-gray-400" />
              </div>
            )}
          </div>
          
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center space-x-2 px-4 py-2 border rounded-md transition-colors ${
              showFilters 
                ? 'bg-blue-600 border-blue-600 text-white' 
                : `${buttonSecondaryClass}`
            }`}
          >
            <Filter className="h-4 w-4" />
            <span>Filters</span>
          </button>
          
          <button
            onClick={() => setIsCreating(true)}
            className={`flex items-center space-x-2 px-4 py-2 ${buttonPrimaryClass} text-white rounded-md transition-colors whitespace-nowrap`}
          >
            <Plus className="h-5 w-5" />
            <span>New Mold</span>
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className={`rounded-lg border p-4 ${cardBgClass} ${cardBorderClass}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>Department</label>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              >
                <option value="">All Departments</option>
                {departments.map(dept => (
                  <option key={dept._id} value={dept._id}>{dept.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              >
                <option value="">All Status</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            
            <div>
              <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>Sort By</label>
              <div className="flex space-x-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={`flex-1 px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="name">Name</option>
                  <option value="productionCapacityPerHour">Capacity</option>
                  <option value="createdAt">Created Date</option>
                </select>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className={`px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="asc">↑</option>
                  <option value="desc">↓</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end mt-4">
            <button
              onClick={clearFilters}
              className={`px-4 py-2 ${textSecondaryClass} hover:${textClass} text-sm`}
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      {pagination && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-4 rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm ${textSecondaryClass}`}>Total Molds</p>
                <p className={`text-xl font-semibold ${textClass}`}>{pagination.totalMolds}</p>
              </div>
              <PackageOpen className={`h-8 w-8 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
            </div>
          </div>

          <div className={`p-4 rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm ${textSecondaryClass}`}>Current Page</p>
                <p className={`text-xl font-semibold ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                  {pagination.currentPage} of {pagination.totalPages}
                </p>
              </div>
              <Power className={`h-8 w-8 ${isDarkMode ? 'text-green-400' : 'text-green-500'}`} />
            </div>
          </div>

          <div className={`p-4 rounded-lg border ${cardBgClass} ${cardBorderClass}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm ${textSecondaryClass}`}>Showing</p>
                <p className={`text-xl font-semibold ${isDarkMode ? 'text-yellow-400' : 'text-amber-600'}`}>
                  {molds.length} molds
                </p>
              </div>
              <PackageOpen className={`h-8 w-8 ${isDarkMode ? 'text-yellow-400' : 'text-amber-500'}`} />
            </div>
          </div>
        </div>
      )}

      {/* Create Mold Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg border w-full max-w-md ${cardBgClass} ${cardBorderClass}`}>
            <div className={`p-6 border-b ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${textClass}`}>Create New Mold</h3>
                <button 
                  onClick={() => setIsCreating(false)}
                  className={textSecondaryClass}
                >
                  &times;
                </button>
              </div>
            </div>
            
            <FormProvider {...createFormMethods}>
              <form onSubmit={handleCreateMold} className="p-6 space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Mold Name *
                  </label>
                  <input
                    type="text"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter mold name"
                    {...createFormMethods.register('name')}
                  />
                  {createFormMethods.formState.errors.name && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Description
                  </label>
                  <textarea
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter mold description"
                    rows={3}
                    {...createFormMethods.register('description')}
                  />
                  {createFormMethods.formState.errors.description && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.description.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Production Capacity (units/hour) *
                  </label>
                  <input
                    type="number"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter production capacity"
                    {...createFormMethods.register('productionCapacityPerHour', { valueAsNumber: true })}
                  />
                  {createFormMethods.formState.errors.productionCapacityPerHour && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.productionCapacityPerHour.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Department *
                  </label>
                  <select
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...createFormMethods.register('departmentId')}
                  >
                    <option value="">Select department</option>
                    {departments.map((dept) => (
                      <option key={dept._id} value={dept._id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  {createFormMethods.formState.errors.departmentId && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.departmentId.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Active Status
                  </label>
                  <div className="flex items-center">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        {...createFormMethods.register('isActive')}
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      <span className={`ml-3 text-sm ${textSecondaryClass}`}>
                        {createFormMethods.watch('isActive') ? 'Active' : 'Inactive'}
                      </span>
                    </label>
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className={`px-4 py-2 border ${buttonSecondaryClass} rounded-md`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 ${buttonPrimaryClass} text-white rounded-md`}
                  >
                    Create Mold
                  </button>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
      )}

      {/* Edit Mold Modal */}
      {editingMold && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg border w-full max-w-md ${cardBgClass} ${cardBorderClass}`}>
            <div className={`p-6 border-b ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${textClass}`}>Edit Mold</h3>
                <button 
                  onClick={() => setEditingMold(null)}
                  className={textSecondaryClass}
                >
                  &times;
                </button>
              </div>
            </div>
            
            <FormProvider {...editFormMethods}>
              <form onSubmit={handleUpdateMold} className="p-6 space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Mold Name *
                  </label>
                  <input
                    type="text"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter mold name"
                    {...editFormMethods.register('name')}
                  />
                  {editFormMethods.formState.errors.name && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Description
                  </label>
                  <textarea
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter mold description"
                    rows={3}
                    {...editFormMethods.register('description')}
                  />
                  {editFormMethods.formState.errors.description && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.description.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Production Capacity (units/hour) *
                  </label>
                  <input
                    type="number"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="Enter production capacity"
                    {...editFormMethods.register('productionCapacityPerHour', { valueAsNumber: true })}
                  />
                  {editFormMethods.formState.errors.productionCapacityPerHour && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.productionCapacityPerHour.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Department *
                  </label>
                  <select
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...editFormMethods.register('departmentId')}
                  >
                    <option value="">Select department</option>
                    {departments.map((dept) => (
                      <option key={dept._id} value={dept._id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  {editFormMethods.formState.errors.departmentId && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.departmentId.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Active Status
                  </label>
                  <div className="flex items-center">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        {...editFormMethods.register('isActive')}
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      <span className={`ml-3 text-sm ${textSecondaryClass}`}>
                        {editFormMethods.watch('isActive') ? 'Active' : 'Inactive'}
                      </span>
                    </label>
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingMold(null)}
                    className={`px-4 py-2 border ${buttonSecondaryClass} rounded-md`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 ${buttonPrimaryClass} text-white rounded-md`}
                  >
                    Update Mold
                  </button>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
      )}

      {/* Molds Table */}
      <div className={`rounded-lg border overflow-hidden ${cardBgClass} ${cardBorderClass}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className={tableHeaderClass}>
              <tr>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Mold
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Description
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Department
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Capacity
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Status
                </th>
                <th scope="col" className={`px-6 py-3 text-right text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-gray-700' : 'divide-gray-200'}`}>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center">
                    <div className="flex justify-center">
                      <Loader className="h-6 w-6 animate-spin text-blue-500" />
                    </div>
                  </td>
                </tr>
              ) : molds.length > 0 ? (
                molds.map((mold) => (
                  <tr 
                    key={mold._id} 
                    className={`${tableRowHoverClass} ${!mold.isActive ? 'opacity-70' : ''}`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className={`flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${
                          mold.isActive 
                            ? isDarkMode ? 'bg-blue-500' : 'bg-blue-500'
                            : isDarkMode ? 'bg-gray-600' : 'bg-gray-300'
                        }`}>
                          <PackageOpen className="h-6 w-6 text-white" />
                        </div>
                        <div className="ml-4">
                          <div className={`text-sm font-medium ${textClass}`}>
                            {mold.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`text-sm max-w-md truncate ${textSecondaryClass}`}>
                        {mold.description || 'No description'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm ${textClass}`}>
                        {getDepartmentName(mold)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={textClass}>{mold.productionCapacityPerHour} units/hour</span> 
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        mold.isActive 
                          ? isDarkMode 
                            ? 'bg-green-900/50 text-green-400' 
                            : 'bg-green-100 text-green-800'
                          : isDarkMode 
                            ? 'bg-red-900/50 text-red-400' 
                            : 'bg-red-100 text-red-800'
                      }`}>
                        {mold.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => {
                            setEditingMold(mold);
                          }}
                          className={`p-1 rounded-md hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'} ${
                            isDarkMode 
                              ? 'text-blue-400 hover:text-blue-300' 
                              : 'text-blue-600 hover:text-blue-800'
                          }`}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(mold._id, mold.isActive)}
                          disabled={statusTogglingId === mold._id}
                          className={`p-1 rounded-md ${
                            statusTogglingId === mold._id ? 'opacity-50' : ''
                          } ${
                            mold.isActive 
                              ? isDarkMode 
                                ? 'text-yellow-400 hover:text-yellow-300' 
                                : 'text-amber-600 hover:text-amber-800'
                              : isDarkMode 
                                ? 'text-green-400 hover:text-green-300' 
                                : 'text-green-600 hover:text-green-800'
                          } hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}
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
                          className={`p-1 rounded-md hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'} ${
                            deletingId === mold._id ? 'opacity-50' : ''
                          } ${
                            isDarkMode 
                              ? 'text-red-400 hover:text-red-300' 
                              : 'text-red-600 hover:text-red-800'
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
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <PackageOpen className={`h-12 w-12 ${textSecondaryClass} mb-4`} />
                      <h3 className={`text-lg font-medium mb-2 ${textSecondaryClass}`}>No molds found</h3>
                      <p className={textSecondaryClass}>
                        {searchTerm || departmentFilter || statusFilter !== ''
                          ? 'No molds match your current filters' 
                          : 'Get started by creating your first mold'}
                      </p>
                      <button 
                        onClick={() => setIsCreating(true)}
                        className={`mt-4 px-4 py-2 ${buttonPrimaryClass} text-white rounded-md`}
                      >
                        Create Mold
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {pagination && !loading && <Pagination pagination={pagination} />}
      </div>
    </div>
  );
};

export default Molds;
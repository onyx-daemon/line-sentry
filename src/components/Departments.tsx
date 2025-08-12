import React, { useState, useEffect, useCallback, useContext } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Department } from '../types';
import apiService from '../services/api';
import { 
  Building2, 
  Plus, 
  Edit, 
  Trash2, 
  Power, 
  PowerOff,
  Search,
  Loader,
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
  totalDepartments: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextPage: number | null;
  prevPage: number | null;
}

interface DepartmentsResponse {
  departments: Department[];
  pagination: PaginationData;
  filters: {
    search: string;
    isActive: string;
    sortBy: string;
    sortOrder: string;
  };
}

// Zod schemas
const departmentSchema = z.object({
  name: z.string()
    .min(3, "Name must be at least 3 characters")
    .max(50, "Name cannot exceed 50 characters"),
  description: z.string()
    .max(200, "Description cannot exceed 200 characters")
    .optional(),
});

type DepartmentFormData = z.infer<typeof departmentSchema>;

const Departments: React.FC = () => {
  const { isAdmin } = useAuth();
  const { isDarkMode } = useContext(ThemeContext);
  const navigate = useNavigate();
  
  // Pagination and filtering states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [showFilters, setShowFilters] = useState(false);
  
  // Modal states
  const [isCreating, setIsCreating] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);
  
  // Data states
  const [departmentsData, setDepartmentsData] = useState<DepartmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  
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
  const createFormMethods = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: {
      name: '',
      description: ''
    }
  });

  const editFormMethods = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: {
      name: '',
      description: ''
    }
  });

  // Reset forms when modals open/close
  useEffect(() => {
    if (isCreating) {
      createFormMethods.reset();
    }
  }, [isCreating]);

  useEffect(() => {
    if (editingDepartment) {
      editFormMethods.reset({
        name: editingDepartment.name,
        description: editingDepartment.description || ''
      });
    }
  }, [editingDepartment]);

  const fetchData = useCallback(async (page = 1, search = '', isActive = '') => {
    try {
      setLoading(true);
      
      const params = {
        page,
        limit: pageSize,
        sortBy,
        sortOrder,
        ...(search && { search }),
        ...(isActive !== '' && { isActive })
      };

      const data = await apiService.getDepartmentsAdmin(params);
      setDepartmentsData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch departments';
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
      if (searchTerm !== (departmentsData?.filters.search || '')) {
        fetchData(1, searchTerm, statusFilter);
      }
    }, 500);

    setSearchTimeout(timeout);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [searchTerm]);

  useEffect(() => {
    fetchData(1, searchTerm, statusFilter);
  }, [fetchData, statusFilter, sortBy, sortOrder]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && departmentsData && page <= departmentsData.pagination.totalPages) {
      fetchData(page, searchTerm, statusFilter);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    fetchData(1, searchTerm, statusFilter);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
    setSortBy('name');
    setSortOrder('asc');
    setCurrentPage(1);
  };

  const handleCreateDepartment = createFormMethods.handleSubmit(async (formData) => {
    try {
      await apiService.createDepartment(formData);
      toast.success('Department created successfully');
      
      // Refresh the current page
      fetchData(currentPage, searchTerm, statusFilter);
      setIsCreating(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create department';
      toast.error(message);
    }
  });

  const handleUpdateDepartment = editFormMethods.handleSubmit(async (formData) => {
    if (!editingDepartment) return;
    
    try {
      await apiService.updateDepartment(editingDepartment._id, formData);
      toast.success('Department updated successfully');
      
      // Refresh the current page
      fetchData(currentPage, searchTerm, statusFilter);
      setEditingDepartment(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update department';
      toast.error(message);
    }
  });

  const handleToggleStatus = async (id: string, isActive: boolean) => {
    try {
      setStatusTogglingId(id);
      await apiService.updateDepartment(id, { isActive: !isActive });
      toast.success(`Department ${!isActive ? 'activated' : 'deactivated'} successfully`);
      
      // Refresh the current page
      fetchData(currentPage, searchTerm, statusFilter);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update department status';
      toast.error(message);
    } finally {
      setStatusTogglingId(null);
    }
  };

  const handleDeleteDepartment = async (id: string) => {
    if (window.confirm('Are you sure you want to permanently delete this department? This will also delete all associated machines and cannot be undone.')) {
      try {
        setDeletingId(id);
        await apiService.deleteDepartment(id);
        toast.success('Department deleted successfully');
        
        // If we're on the last page and it becomes empty, go to previous page
        if (departmentsData && departmentsData.departments.length === 1 && currentPage > 1) {
          fetchData(currentPage - 1, searchTerm, statusFilter);
        } else {
          fetchData(currentPage, searchTerm, statusFilter);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete department';
        toast.error(message);
      } finally {
        setDeletingId(null);
      }
    }
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
          {Math.min(pagination.currentPage * pagination.limit, pagination.totalDepartments)} of{' '}
          {pagination.totalDepartments} results
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

  const departments = departmentsData?.departments || [];
  const pagination = departmentsData?.pagination;

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
          <Building2 className={`h-8 w-8 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
          <div>
            <h1 className={`text-2xl font-bold ${textClass}`}>Departments</h1>
            <p className={textSecondaryClass}>Manage and configure your industrial departments</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search departments..."
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
            <span>New Department</span>
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className={`rounded-lg border p-4 ${cardBgClass} ${cardBorderClass}`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  <option value="createdAt">Created Date</option>
                  <option value="machineCount">Machine Count</option>
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
                <p className={`text-sm ${textSecondaryClass}`}>Total Departments</p>
                <p className={`text-xl font-semibold ${textClass}`}>{pagination.totalDepartments}</p>
              </div>
              <Building2 className={`h-8 w-8 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
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
                  {departments.length} departments
                </p>
              </div>
              <Building2 className={`h-8 w-8 ${isDarkMode ? 'text-yellow-400' : 'text-amber-500'}`} />
            </div>
          </div>
        </div>
      )}

      {/* Create Department Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg border w-full max-w-md ${cardBgClass} ${cardBorderClass}`}>
            <div className={`p-6 border-b ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${textClass}`}>Create New Department</h3>
                <button 
                  onClick={() => setIsCreating(false)}
                  className={textSecondaryClass}
                >
                  &times;
                </button>
              </div>
            </div>
            
            <FormProvider {...createFormMethods}>
              <form onSubmit={handleCreateDepartment} className="p-6 space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Department Name *
                  </label>
                  <input
                    type="text"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
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
                    rows={3}
                    {...createFormMethods.register('description')}
                  />
                  {createFormMethods.formState.errors.description && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.description.message}
                    </p>
                  )}
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
                    Create Department
                  </button>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
      )}

      {/* Edit Department Modal */}
      {editingDepartment && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg border w-full max-w-md ${cardBgClass} ${cardBorderClass}`}>
            <div className={`p-6 border-b ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${textClass}`}>Edit Department</h3>
                <button 
                  onClick={() => setEditingDepartment(null)}
                  className={textSecondaryClass}
                >
                  &times;
                </button>
              </div>
            </div>
            
            <FormProvider {...editFormMethods}>
              <form onSubmit={handleUpdateDepartment} className="p-6 space-y-4">
                <div>
                  <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Department Name *
                  </label>
                  <input
                    type="text"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
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
                    rows={3}
                    {...editFormMethods.register('description')}
                  />
                  {editFormMethods.formState.errors.description && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.description.message}
                    </p>
                  )}
                </div>
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingDepartment(null)}
                    className={`px-4 py-2 border ${buttonSecondaryClass} rounded-md`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 ${buttonPrimaryClass} text-white rounded-md`}
                  >
                    Update Department
                  </button>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
      )}

      {/* Departments Table */}
      <div className={`rounded-lg border overflow-hidden ${cardBgClass} ${cardBorderClass}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className={tableHeaderClass}>
              <tr>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Department
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Description
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Status
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Machines
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Created
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
              ) : departments.length > 0 ? (
                departments.map((department) => (
                  <tr 
                    key={department._id} 
                    className={`${tableRowHoverClass} cursor-pointer ${!department.isActive ? 'opacity-70' : ''}`}
                    onClick={() => navigate(`/department/${department._id}`)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className={`flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${
                          department.isActive 
                            ? isDarkMode ? 'bg-blue-500' : 'bg-blue-500'
                            : isDarkMode ? 'bg-gray-600' : 'bg-gray-300'
                        }`}>
                          <Building2 className="h-6 w-6 text-white" />
                        </div>
                        <div className="ml-4">
                          <div className={`text-sm font-medium flex items-center ${textClass}`}>
                            {department.name}
                            {!department.isActive && (
                              <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                                isDarkMode 
                                  ? 'bg-gray-700 text-gray-300' 
                                  : 'bg-gray-200 text-gray-700'
                              }`}>
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`text-sm max-w-md truncate ${textSecondaryClass}`}>
                        {department.description || 'No description'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        department.isActive 
                          ? isDarkMode 
                            ? 'bg-green-900/50 text-green-400' 
                            : 'bg-green-100 text-green-800'
                          : isDarkMode 
                            ? 'bg-red-900/50 text-red-400' 
                            : 'bg-red-100 text-red-800'
                      }`}>
                        {department.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm ${textClass}`}>
                        {department.machineCount || 0}
                      </div>
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${textSecondaryClass}`}>
                      {new Date(department.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingDepartment(department);
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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleStatus(department._id, department.isActive);
                          }}
                          disabled={statusTogglingId === department._id}
                          className={`p-1 rounded-md ${
                            statusTogglingId === department._id ? 'opacity-50' : ''
                          } ${
                            department.isActive 
                              ? isDarkMode 
                                ? 'text-yellow-400 hover:text-yellow-300' 
                                : 'text-amber-600 hover:text-amber-800'
                              : isDarkMode 
                                ? 'text-green-400 hover:text-green-300' 
                                : 'text-green-600 hover:text-green-800'
                          } hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}
                          title={department.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {statusTogglingId === department._id ? (
                            <Loader className="h-4 w-4 animate-spin" />
                          ) : department.isActive ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDepartment(department._id);
                          }}
                          disabled={deletingId === department._id}
                          className={`p-1 rounded-md hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'} ${
                            deletingId === department._id ? 'opacity-50' : ''
                          } ${
                            isDarkMode 
                              ? 'text-red-400 hover:text-red-300' 
                              : 'text-red-600 hover:text-red-800'
                          }`}
                          title="Delete permanently"
                        >
                          {deletingId === department._id ? (
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
                      <Building2 className={`h-12 w-12 ${textSecondaryClass} mb-4`} />
                      <h3 className={`text-lg font-medium mb-2 ${textSecondaryClass}`}>No departments found</h3>
                      <p className={textSecondaryClass}>
                        {searchTerm || statusFilter !== ''
                          ? 'No departments match your current filters' 
                          : 'Get started by creating your first department'}
                      </p>
                      <button 
                        onClick={() => setIsCreating(true)}
                        className={`mt-4 px-4 py-2 ${buttonPrimaryClass} text-white rounded-md`}
                      >
                        Create Department
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

export default Departments;
import React, { useState, useEffect, useCallback, useContext } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext';
import apiService from '../services/api';
import {
  Users as UsersIcon,
  User as UserIcon,
  Plus, 
  Edit, 
  Trash2, 
  Power, 
  PowerOff,
  Search,
  Loader,
  Building2,
  Eye,
  EyeOff,
  ChevronLeft,  
  ChevronRight,
  Filter
} from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { ThemeContext } from '../App';

interface PaginationData {
  currentPage: number;
  totalPages: number;
  totalUsers: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextPage: number | null;
  prevPage: number | null;
}

interface UsersResponse {
  users: any[];
  pagination: PaginationData;
  filters: {
    search: string;
    role: string;
    department: string;
    isActive: string;
    sortBy: string;
    sortOrder: string;
  };
}

// Zod schemas
const baseUserSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username cannot exceed 30 characters"),
  email: z.string()
    .email("Invalid email address")
    .max(50, "Email cannot exceed 50 characters"),
  role: z.enum(['admin', 'operator']),
  departmentId: z.string().optional(),
});

const createUserSchema = baseUserSchema.extend({
  password: z.string()
    .min(6, "Password must be at least 6 characters")
    .max(30, "Password cannot exceed 30 characters"),
}).superRefine((data, ctx) => {
  if (data.role === 'operator' && !data.departmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Department is required for operators",
      path: ["departmentId"],
    });
  }
});

const editUserSchema = baseUserSchema.extend({
  password: z.string()
    .min(6, "Password must be at least 6 characters")
    .max(30, "Password cannot exceed 30 characters")
    .optional()
    .or(z.literal('')),
}).superRefine((data, ctx) => {
  if (data.role === 'operator' && !data.departmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Department is required for operators",
      path: ["departmentId"],
    });
  }
});

type CreateUserFormData = z.infer<typeof createUserSchema>;
type EditUserFormData = z.infer<typeof editUserSchema>;

const Users: React.FC = () => {
  const { isAdmin } = useAuth();
  const { isDarkMode } = useContext(ThemeContext);
  const [usersData, setUsersData] = useState<UsersResponse | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Pagination and filtering states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showFilters, setShowFilters] = useState(false);
  
  // Modal states
  const [isCreating, setIsCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

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
  const createFormMethods = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      role: 'operator',
      departmentId: '',
    }
  });

  const editFormMethods = useForm<EditUserFormData>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      username: '',
      email: '',
      role: 'operator',
      departmentId: '',
      password: '',
    }
  });

  // Reset create form when modal opens/closes
  useEffect(() => {
    if (isCreating) {
      createFormMethods.reset({
        username: '',
        email: '',
        password: '',
        role: 'operator',
        departmentId: '',
      });
    }
  }, [isCreating]);

  // Reset edit form when editing user changes
  useEffect(() => {
    if (editingUser) {
      editFormMethods.reset({
        username: editingUser.username,
        email: editingUser.email,
        role: editingUser.role,
        departmentId: editingUser.departmentId 
          ? (typeof editingUser.departmentId === 'object' 
              ? editingUser.departmentId._id 
              : editingUser.departmentId)
          : '',
        password: ''
      });
    }
  }, [editingUser]);

  const fetchUsers = useCallback(async (page = 1, search = '', role = '', department = '', isActive = '') => {
    try {
      setLoading(true);
      
      const params = {
        page,
        limit: pageSize,
        sortBy,
        sortOrder,
        ...(search && { search }),
        ...(role && { role }),
        ...(department && { department }),
        ...(isActive !== '' && { isActive })
      };

      const data: UsersResponse = await apiService.getUsersAdmin(params);
      setUsersData(data);
      setCurrentPage(data.pagination.currentPage);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch users';
      toast.error(message);
      console.error('Fetch users error:', err);
    } finally {
      setLoading(false);
    }
  }, [pageSize, sortBy, sortOrder]);

  const fetchDepartments = async () => {
    try {
      const departmentsData = await apiService.getDepartments();
      setDepartments(departmentsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch departments';
      toast.error(message);
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  useEffect(() => {
    fetchUsers(1, searchTerm, roleFilter, departmentFilter, statusFilter);
  }, [fetchUsers, roleFilter, departmentFilter, statusFilter, sortBy, sortOrder]);

  // Debounced search effect
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const timeout = setTimeout(() => {
      if (searchTerm !== (usersData?.filters.search || '')) {
        fetchUsers(1, searchTerm, roleFilter, departmentFilter, statusFilter);
      }
    }, 500);

    setSearchTimeout(timeout);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [searchTerm]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && usersData && page <= usersData.pagination.totalPages) {
      fetchUsers(page, searchTerm, roleFilter, departmentFilter, statusFilter);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    fetchUsers(1, searchTerm, roleFilter, departmentFilter, statusFilter);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setRoleFilter('');
    setDepartmentFilter('');
    setStatusFilter('');
    setSortBy('createdAt');
    setSortOrder('desc');
    setCurrentPage(1);
  };

  const handleCreateUser = createFormMethods.handleSubmit(async (formData) => {
    try {
      const userData: any = { ...formData };
      
      if (userData.role === 'admin') {
        userData.departmentId = undefined;
      }

      await apiService.createUser(userData);
      
      setIsCreating(false);
      toast.success("User created successfully");
      
      // Refresh the current page
      fetchUsers(currentPage, searchTerm, roleFilter, departmentFilter, statusFilter);
    } catch (err) {
      let message = 'Failed to create user';
      
      if (err instanceof Error) {
        if (err.message.includes('E11000 duplicate key error')) {
          if (err.message.includes('username')) {
            message = 'Username already exists';
          } else if (err.message.includes('email')) {
            message = 'Email already exists';
          }
        } else {
          message = err.message;
        }
      }
      
      toast.error(message);
    }
  });

  const handleUpdateUser = editFormMethods.handleSubmit(async (formData) => {
    if (!editingUser) return;

    try {
      const updateData: any = {
        username: formData.username,
        email: formData.email,
        role: formData.role,
      };

      // Add password if provided
      if (formData.password && formData.password.trim() !== '') {
        updateData.password = formData.password;
      }

      if (formData.role === 'operator') {
        updateData.departmentId = formData.departmentId;
      } else {
        updateData.departmentId = undefined;
      }

      await apiService.updateUser(editingUser._id, updateData);
      setEditingUser(null);
      toast.success("User updated successfully");
      
      // Refresh the current page
      fetchUsers(currentPage, searchTerm, roleFilter, departmentFilter, statusFilter);
    } catch (err) {
      let message = 'Failed to update user';
      
      if (err instanceof Error) {
        if (err.message.includes('E11000 duplicate key error')) {
          if (err.message.includes('username')) {
            message = 'Username already exists';
          } else if (err.message.includes('email')) {
            message = 'Email already exists';
          }
        } else {
          message = err.message;
        }
      }
      
      toast.error(message);
    }
  });

  const handleToggleStatus = async (id: string, isActive: boolean) => {
    try {
      setStatusTogglingId(id);
      await apiService.updateUser(id, { isActive: !isActive });
      toast.success(`User ${!isActive ? 'activated' : 'deactivated'} successfully`);
      
      // Refresh the current page
      fetchUsers(currentPage, searchTerm, roleFilter, departmentFilter, statusFilter);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update user status';
      toast.error(message);
    } finally {
      setStatusTogglingId(null);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (window.confirm('Are you sure you want to permanently delete this user? This action cannot be undone.')) {
      try {
        setDeletingId(id);
        await apiService.deleteUser(id);
        toast.success("User deleted successfully");
        
        // If we're on the last page and it becomes empty, go to previous page
        if (usersData && usersData.users.length === 1 && currentPage > 1) {
          fetchUsers(currentPage - 1, searchTerm, roleFilter, departmentFilter, statusFilter);
        } else {
          fetchUsers(currentPage, searchTerm, roleFilter, departmentFilter, statusFilter);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete user';
        toast.error(message);
      } finally {
        setDeletingId(null);
      }
    }
  };

  const getDepartmentName = (deptData: any) => {
    if (!deptData) return 'N/A';
    
    if (typeof deptData === 'object' && deptData.name) {
      return deptData.name;
    }
    
    const department = departments.find(d => d._id === deptData);
    return department ? department.name : 'N/A';
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
          {Math.min(pagination.currentPage * pagination.limit, pagination.totalUsers)} of{' '}
          {pagination.totalUsers} results
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

  if (loading && !usersData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const users = usersData?.users || [];
  const pagination = usersData?.pagination;

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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <UsersIcon className={`h-8 w-8 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
          <div>
            <h1 className={`text-2xl font-bold ${textClass}`}>User Management</h1>
            <p className={textSecondaryClass}>Manage system users and their permissions</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search users..."
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
          
          {isAdmin && (
            <button 
              onClick={() => setIsCreating(true)}
              className={`flex items-center justify-center space-x-2 px-4 py-2 ${buttonPrimaryClass} text-white rounded-md transition-colors whitespace-nowrap`}
            >
              <Plus className="h-5 w-5" />
              <span>New User</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className={`rounded-lg border p-4 ${cardBgClass} ${cardBorderClass}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>Role</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              >
                <option value="">All Roles</option>
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
              </select>
            </div>
            
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
                  <option value="createdAt">Created Date</option>
                  <option value="username">Username</option>
                  <option value="email">Email</option>
                  <option value="role">Role</option>
                </select>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className={`px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  <option value="desc">↓</option>
                  <option value="asc">↑</option>
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
                <p className={`text-sm ${textSecondaryClass}`}>Total Users</p>
                <p className={`text-xl font-semibold ${textClass}`}>{pagination.totalUsers}</p>
              </div>
              <UserIcon className={`h-8 w-8 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
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
                  {users.length} users
                </p>
              </div>
              <UsersIcon className={`h-8 w-8 ${isDarkMode ? 'text-yellow-400' : 'text-amber-500'}`} />
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg border w-full max-w-md ${cardBgClass} ${cardBorderClass}`}>
            <div className={`p-6 border-b ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${textClass}`}>Create New User</h3>
                <button 
                  onClick={() => setIsCreating(false)}
                  className={textSecondaryClass}
                >
                  &times;
                </button>
              </div>
            </div>
            
            <FormProvider {...createFormMethods}>
              <form onSubmit={handleCreateUser} className="p-6 space-y-4">
                <div>
                  <label htmlFor="username" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Username *
                  </label>
                  <input
                    type="text"
                    id="username"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...createFormMethods.register('username')}
                  />
                  {createFormMethods.formState.errors.username && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.username.message}
                    </p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="email" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Email *
                  </label>
                  <input
                    type="email"
                    id="email"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...createFormMethods.register('email')}
                  />
                  {createFormMethods.formState.errors.email && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.email.message}
                    </p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="password" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      id="password"
                      className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      {...createFormMethods.register('password')}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5 text-gray-400" />
                      ) : (
                        <Eye className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                  </div>
                  {createFormMethods.formState.errors.password && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {createFormMethods.formState.errors.password.message}
                    </p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="role" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Role *
                  </label>
                  <select
                    id="role"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...createFormMethods.register('role')}
                  >
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                  </select>
                </div>
                
                {createFormMethods.watch('role') === 'operator' && (
                  <div>
                    <label htmlFor="departmentId" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                      Department *
                    </label>
                    <select
                      id="departmentId"
                      className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      {...createFormMethods.register('departmentId')}
                    >
                      <option value="">Select Department</option>
                      {departments.map(dept => (
                        <option key={dept._id} value={dept._id}>{dept.name}</option>
                      ))}
                    </select>
                    {createFormMethods.formState.errors.departmentId && (
                      <p className={`mt-1 text-sm ${errorClass}`}>
                        {createFormMethods.formState.errors.departmentId.message}
                      </p>
                    )}
                  </div>
                )}
                
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
                    Create User
                  </button>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className={`rounded-lg border w-full max-w-md ${cardBgClass} ${cardBorderClass}`}>
            <div className={`p-6 border-b ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-semibold ${textClass}`}>Edit User</h3>
                <button 
                  onClick={() => setEditingUser(null)}
                  className={textSecondaryClass}
                >
                  &times;
                </button>
              </div>
            </div>
            
            <FormProvider {...editFormMethods}>
              <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
                <div>
                  <label htmlFor="edit-username" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Username *
                  </label>
                  <input
                    type="text"
                    id="edit-username"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...editFormMethods.register('username')}
                  />
                  {editFormMethods.formState.errors.username && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.username.message}
                    </p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="edit-email" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Email *
                  </label>
                  <input
                    type="email"
                    id="edit-email"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...editFormMethods.register('email')}
                  />
                  {editFormMethods.formState.errors.email && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.email.message}
                    </p>
                  )}
                </div>
                
                <div>
                  <label htmlFor="edit-password" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showEditPassword ? "text" : "password"}
                      id="edit-password"
                      className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      {...editFormMethods.register('password')}
                      placeholder="Leave blank to keep current password"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                    >
                      {showEditPassword ? (
                        <EyeOff className="h-5 w-5 text-gray-400" />
                      ) : (
                        <Eye className="h-5 w-5 text-gray-400" />
                      )}
                    </button>
                  </div>
                  {editFormMethods.formState.errors.password && (
                    <p className={`mt-1 text-sm ${errorClass}`}>
                      {editFormMethods.formState.errors.password.message}
                    </p>
                  )}
                  <p className={`text-xs mt-1 ${textSecondaryClass}`}>
                    Only enter a value if you want to change the password
                  </p>
                </div>
                
                <div>
                  <label htmlFor="edit-role" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                    Role *
                  </label>
                  <select
                    id="edit-role"
                    className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    {...editFormMethods.register('role')}
                  >
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                  </select>
                </div>
                
                {editFormMethods.watch('role') === 'operator' && (
                  <div>
                    <label htmlFor="edit-departmentId" className={`block text-sm font-medium mb-1 ${textSecondaryClass}`}>
                      Department *
                    </label>
                    <select
                      id="edit-departmentId"
                      className={`w-full px-3 py-2 ${inputBgClass} border ${inputBorderClass} rounded-md ${textClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      {...editFormMethods.register('departmentId')}
                    >
                      <option value="">Select Department</option>
                      {departments.map(dept => (
                        <option key={dept._id} value={dept._id}>{dept.name}</option>
                      ))}
                    </select>
                    {editFormMethods.formState.errors.departmentId && (
                      <p className={`mt-1 text-sm ${errorClass}`}>
                        {editFormMethods.formState.errors.departmentId.message}
                      </p>
                    )}
                  </div>
                )}
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className={`px-4 py-2 border ${buttonSecondaryClass} rounded-md`}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 ${buttonPrimaryClass} text-white rounded-md`}
                  >
                    Update User
                  </button>
                </div>
              </form>
            </FormProvider>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className={`rounded-lg border overflow-hidden ${cardBgClass} ${cardBorderClass}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className={tableHeaderClass}>
              <tr>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  User
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Role
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Department
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Status
                </th>
                <th scope="col" className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                  Created
                </th>
                {isAdmin && (
                  <th scope="col" className={`px-6 py-3 text-right text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'divide-gray-700' : 'divide-gray-200'}`}>
              {users.length > 0 ? (
                users.map((user) => (
                  <tr 
                    key={user._id} 
                    className={`${tableRowHoverClass} ${!user.isActive ? 'opacity-70' : ''}`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                          user.isActive 
                            ? isDarkMode ? 'bg-blue-500' : 'bg-blue-500' 
                            : isDarkMode ? 'bg-gray-600' : 'bg-gray-300'
                        }`}>
                          <UserIcon className="h-5 w-5 text-white" />
                        </div>
                        <div className="ml-4">
                          <div className={`text-sm font-medium flex items-center ${textClass}`}>
                            {user.username}
                            {!user.isActive && (
                              <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                                isDarkMode 
                                  ? 'bg-gray-700 text-gray-300' 
                                  : 'bg-gray-200 text-gray-700'
                              }`}>
                                Inactive
                              </span>
                            )}
                          </div>
                          <div className={`text-xs ${textSecondaryClass}`}>
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        user.role === 'admin' 
                          ? isDarkMode 
                            ? 'bg-purple-900/50 text-purple-400' 
                            : 'bg-purple-100 text-purple-800'
                          : isDarkMode 
                            ? 'bg-blue-900/50 text-blue-400' 
                            : 'bg-blue-100 text-blue-800'
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm flex items-center ${textClass}`}>
                        {user.departmentId ? (
                          <>
                            <Building2 className={`h-4 w-4 mr-1 ${isDarkMode ? 'text-blue-400' : 'text-blue-500'}`} />
                            {getDepartmentName(user.departmentId)}
                          </>
                        ) : (
                          'N/A'
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        user.isActive 
                          ? isDarkMode 
                            ? 'bg-green-900/50 text-green-400' 
                            : 'bg-green-100 text-green-800'
                          : isDarkMode 
                            ? 'bg-red-900/50 text-red-400' 
                            : 'bg-red-100 text-red-800'
                      }`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${textSecondaryClass}`}>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingUser({
                                ...user,
                                _id: user._id,
                                departmentId: user.departmentId 
                                  ? (typeof user.departmentId === 'object' 
                                      ? user.departmentId._id 
                                      : user.departmentId)
                                  : '',
                                password: ''
                              });
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
                              handleToggleStatus(user._id, user.isActive);
                            }}
                            disabled={statusTogglingId === user._id}
                            className={`p-1 rounded-md hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'} ${
                              statusTogglingId === user._id ? 'opacity-50' : ''
                            } ${
                              user.isActive 
                                ? isDarkMode 
                                  ? 'text-yellow-400 hover:text-yellow-300' 
                                  : 'text-amber-600 hover:text-amber-800'
                                : isDarkMode 
                                  ? 'text-green-400 hover:text-green-300' 
                                  : 'text-green-600 hover:text-green-800'
                            }`}
                            title={user.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {statusTogglingId === user._id ? (
                              <Loader className="h-4 w-4 animate-spin" />
                            ) : user.isActive ? (
                              <PowerOff className="h-4 w-4" />
                            ) : (
                              <Power className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteUser(user._id);
                            }}
                            disabled={deletingId === user._id}
                            className={`p-1 rounded-md hover:${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'} ${
                              deletingId === user._id ? 'opacity-50' : ''
                            } ${
                              isDarkMode 
                                ? 'text-red-400 hover:text-red-300' 
                                : 'text-red-600 hover:text-red-800'
                            }`}
                            title="Delete permanently"
                          >
                            {deletingId === user._id ? (
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
                      <UserIcon className={`h-12 w-12 ${textSecondaryClass} mb-4`} />
                      <h3 className={`text-lg font-medium mb-2 ${textSecondaryClass}`}>No users found</h3>
                      <p className={textSecondaryClass}>
                        {searchTerm || roleFilter || departmentFilter || statusFilter !== ''
                          ? 'No users match your current filters' 
                          : 'Get started by creating your first user'}
                      </p>
                      {isAdmin && !searchTerm && !roleFilter && !departmentFilter && statusFilter === '' && (
                        <button 
                          onClick={() => setIsCreating(true)}
                          className={`mt-4 px-4 py-2 ${buttonPrimaryClass} text-white rounded-md`}
                        >
                          Create User
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {pagination && <Pagination pagination={pagination} />}
      </div>
    </div>
  );
};

export default Users;
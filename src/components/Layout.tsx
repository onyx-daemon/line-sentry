import React from 'react';
import { useContext } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ThemeContext } from '../App';
import { 
  LogOut, 
  Settings, 
  BarChart3, 
  Building2, 
  User,
  Menu,
  Activity,
  X,
  PackagePlus,
  FileText,
  Sun,
  Moon
} from 'lucide-react';
import { useState } from 'react';

const Layout: React.FC = () => {
  const { user, logout, isAdmin } = useAuth();
  const { isDarkMode, toggleTheme } = useContext(ThemeContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: BarChart3 },
    ...(isAdmin ? [
      { name: 'Users', href: '/users', icon: User },
      { name: 'Sensors', href: '/sensors', icon: Activity },
      { name: 'Departments', href: '/departments', icon: Building2 },
      { name: 'Molds', href: '/molds', icon: PackagePlus},
      { name: 'Reports', href: '/reports', icon: FileText },
      { name: 'Configuration', href: '/config', icon: Settings },
      
    ] : []),
  ];

  const isActive = (href: string) => location.pathname === href;

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-slate-100'}`}>
      {/* Mobile sidebar */}
      <div className={`fixed inset-0 z-50 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`}>
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75" onClick={() => setSidebarOpen(false)} />
        <div className={`fixed inset-y-0 left-0 flex w-64 flex-col ${isDarkMode ? 'bg-gray-800' : 'bg-slate-50 shadow-2xl'}`}>
          <div className={`flex h-16 items-center justify-between px-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-slate-200'}`}>
            <span className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>LineSentry</span>
            <button onClick={() => setSidebarOpen(false)} className={`${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-slate-500 hover:text-slate-700'}`}>
              <X className="h-6 w-6" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navigation.map((item) => (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.href);
                  setSidebarOpen(false);
                }}
                className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive(item.href)
                    ? isDarkMode 
                      ? 'bg-gray-900 text-white shadow-md' 
                      : 'bg-slate-600 text-white shadow-lg shadow-slate-600/25'
                    : isDarkMode 
                      ? 'text-gray-300 hover:bg-gray-700 hover:text-white' 
                      : 'text-slate-700 hover:bg-slate-200 hover:text-slate-800'
                }`}
              >
                <item.icon className={`mr-3 h-5 w-5 ${isActive(item.href) && !isDarkMode ? 'text-white' : ''}`} />
                {item.name}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className={`flex flex-1 flex-col ${isDarkMode ? 'bg-gray-800' : 'bg-slate-50 shadow-xl border-r border-slate-200'}`}>
          <div className={`flex h-16 items-center px-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-slate-200'}`}>
            <span className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>LineSentry</span>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navigation.map((item) => (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(item.href);
                }}
                className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive(item.href)
                    ? isDarkMode 
                      ? 'bg-gray-900 text-white shadow-md' 
                      : 'bg-slate-600 text-white shadow-lg shadow-slate-600/25'
                    : isDarkMode 
                      ? 'text-gray-300 hover:bg-gray-700 hover:text-white' 
                      : 'text-slate-700 hover:bg-slate-200 hover:text-slate-800'
                }`}
              >
                <item.icon className={`mr-3 h-5 w-5 ${isActive(item.href) && !isDarkMode ? 'text-white' : ''}`} />
                {item.name}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64 flex flex-col flex-1">
        <div className={`sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b px-4 sm:gap-x-6 sm:px-6 lg:px-8 backdrop-blur-sm ${
          isDarkMode 
            ? 'border-gray-700 bg-gray-800/95' 
            : 'border-slate-200 bg-slate-50/95 shadow-sm'
        }`}>
          <button
            type="button"
            className={`-m-2.5 p-2.5 lg:hidden transition-colors ${isDarkMode ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'} rounded-md`}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
            <div className="flex flex-1 items-center">
              <h1 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                {navigation.find(item => isActive(item.href))?.name || 'Dashboard'}
              </h1>
            </div>
            <div className="flex items-center gap-x-4 lg:gap-x-6">
              <div className="flex items-center space-x-3">
                <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>
                  <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{user?.username}</div>
                  <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>{user?.role}</div>
                </div>
                <button
                  onClick={toggleTheme}
                  className={`p-2 rounded-lg transition-all duration-200 ${
                    isDarkMode 
                      ? 'text-gray-300 hover:text-white hover:bg-gray-700' 
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'
                  }`}
                  title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </button>
                <button
                  onClick={handleLogout}
                  className={`p-2 rounded-lg transition-all duration-200 ${
                    isDarkMode 
                      ? 'text-gray-300 hover:text-white hover:bg-gray-700' 
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'
                  }`}
                  title="Logout"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <main className="flex-1">
          <div className="px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
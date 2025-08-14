import React, { useState, useRef } from 'react';
import { useContext } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ThemeContext } from '../App';
import { Factory, User, Lock, AlertCircle, Shield } from 'lucide-react';
import ReCAPTCHA from 'react-google-recaptcha';
import apiService from '../services/api';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoInitialized, setDemoInitialized] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const { login } = useAuth();
  const { isDarkMode } = useContext(ThemeContext);
  const navigate = useNavigate();
  const recaptchaRef = useRef<ReCAPTCHA>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Show CAPTCHA after 2 failed attempts or if already shown
    if (loginAttempts >= 2 || showCaptcha) {
      if (!captchaToken) {
        setError('Please complete the CAPTCHA verification');
        setLoading(false);
        setShowCaptcha(true);
        return;
      }
    }

    try {
      await login(username, password, captchaToken || undefined);
      navigate('/dashboard');
    } catch (err) {
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      
      // Show CAPTCHA after 2 failed attempts
      if (newAttempts >= 2) {
        setShowCaptcha(true);
      }
      
      setError(err instanceof Error ? err.message : 'Login failed');
      
      // Reset CAPTCHA on error
      if (recaptchaRef.current) {
        recaptchaRef.current.reset();
        setCaptchaToken(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const initializeDemo = async () => {
    try {
      await apiService.initDemo();
      setDemoInitialized(true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize demo accounts');
    }
  };

  const fillDemoCredentials = (role: 'admin' | 'operator') => {
    setUsername(role);
    setPassword(`${role}123`);
    // Reset login attempts when using demo
    setLoginAttempts(0);
    setShowCaptcha(false);
    setCaptchaToken(null);
    if (recaptchaRef.current) {
      recaptchaRef.current.reset();
    }
  };

  const onCaptchaChange = (token: string | null) => {
    setCaptchaToken(token);
  };

  return (
    <div className={`min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 ${
      isDarkMode 
        ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900' 
        : 'bg-gradient-to-br from-blue-50 via-white to-blue-50'
    }`}>
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center">
            <Factory className="h-8 w-8 text-white" />
          </div>
          <h2 className={`mt-6 text-3xl font-extrabold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Dawlance | LineSentry
          </h2>
          <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Sign in to access your production dashboard
          </p>
          {showCaptcha && (
            <div className={`mt-2 flex items-center justify-center space-x-2 text-xs ${
              isDarkMode ? 'text-yellow-400' : 'text-amber-600'
            }`}>
              <Shield className="h-4 w-4" />
              <span>Security verification required</span>
            </div>
          )}
        </div>

        <div className={`py-8 px-6 shadow-xl rounded-lg border ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-white border-gray-200'
        }`}>
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className={`border border-red-500 px-4 py-3 rounded-md flex items-center ${
                isDarkMode 
                  ? 'bg-red-900/50 text-red-300' 
                  : 'bg-red-50 text-red-700'
              }`}>
                <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="username" className={`block text-sm font-medium mb-2 ${
                isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Username
              </label>
              <div className="relative">
                <div className={`absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none`}>
                  <User className={`h-5 w-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`block w-full pl-10 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    isDarkMode 
                      ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' 
                      : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500'
                  }`}
                  placeholder="Enter your username"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className={`block text-sm font-medium mb-2 ${
                isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Password
              </label>
              <div className="relative">
                <div className={`absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none`}>
                  <Lock className={`h-5 w-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`block w-full pl-10 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    isDarkMode 
                      ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' 
                      : 'border-gray-300 bg-white text-gray-900 placeholder-gray-500'
                  }`}
                  placeholder="Enter your password"
                />
              </div>
            </div>

            {/* CAPTCHA */}
            {showCaptcha && (
              <div className="flex justify-center">
                <ReCAPTCHA
                  ref={recaptchaRef}
                  sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY}
                  onChange={onCaptchaChange}
                  theme={isDarkMode ? 'dark' : 'light'}
                />
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading || (showCaptcha && !captchaToken)}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </div>
          </form>

          <div className={`mt-8 pt-6 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            {/* <p className={`text-center text-sm mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Demo Environment
            </p> */}
            
            {/* {!demoInitialized && (
              <button
                onClick={initializeDemo}
                className={`w-full mb-3 py-2 px-4 border rounded-md text-sm transition-colors ${
                  isDarkMode 
                    ? 'border-gray-600 text-gray-300 hover:bg-gray-700' 
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Initialize Demo Accounts
              </button>
            )} */}

            {/* <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => fillDemoCredentials('admin')}
                className="py-2 px-4 border border-green-600 rounded-md text-sm text-green-400 hover:bg-green-900/20 transition-colors"
              >
                Admin Demo
              </button>
              <button
                onClick={() => fillDemoCredentials('operator')}
                className="py-2 px-4 border border-blue-600 rounded-md text-sm text-blue-400 hover:bg-blue-900/20 transition-colors"
              >
                Operator Demo
              </button>
            </div> */}

            {loginAttempts > 0 && (
              <div className={`mt-4 text-center text-xs ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Login attempts: {loginAttempts}
                {loginAttempts >= 2 && ' (CAPTCHA required)'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
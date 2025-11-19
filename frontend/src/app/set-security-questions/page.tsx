'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/lib/api';

const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  "What city were you born in?",
  "What was the name of your first school?",
  "What is your favorite book?",
  "What was the model of your first car?",
  "What is your favorite movie?",
  "What street did you grow up on?",
  "What is your father's middle name?",
  "What was your childhood nickname?"
];

interface SecurityQuestion {
  question: string;
  answer: string;
}

export default function SetSecurityQuestions() {
  const router = useRouter();
  const { user, actualRole, logout } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Three security questions
  const [questions, setQuestions] = useState<SecurityQuestion[]>([
    { question: '', answer: '' },
    { question: '', answer: '' },
    { question: '', answer: '' }
  ]);

  // Password fields (only for new users with temp password)
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordFields, setShowPasswordFields] = useState(false);

  useEffect(() => {
    console.log('SetSecurityQuestions - useEffect:', { user, hasUser: !!user });
    
    if (!user) {
      console.log('No user found, redirecting to login');
      router.push('/login');
      return;
    }

    console.log('User found:', user);

    // Check if this is a new user with temp password
    // (We'll detect this from localStorage flag set during login)
    const mustChangePassword = localStorage.getItem('must_change_password') === 'true';
    setShowPasswordFields(mustChangePassword);
  }, [user, router]);

  const handleQuestionChange = (index: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[index].question = value;
    setQuestions(newQuestions);
  };

  const handleAnswerChange = (index: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[index].answer = value;
    setQuestions(newQuestions);
  };

  const validateForm = () => {
    // Check all questions selected
    if (questions.some(q => !q.question)) {
      setError('Please select all 3 security questions');
      return false;
    }

    // Check all answers provided
    if (questions.some(q => !q.answer.trim())) {
      setError('Please provide answers to all security questions');
      return false;
    }

    // Check for duplicate questions
    const selectedQuestions = questions.map(q => q.question);
    const uniqueQuestions = new Set(selectedQuestions);
    if (uniqueQuestions.size !== 3) {
      setError('Please select 3 different security questions');
      return false;
    }

    // Check password if required
    if (showPasswordFields) {
      if (!newPassword || newPassword.length < 8) {
        setError('Password must be at least 8 characters');
        return false;
      }
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match');
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validateForm()) return;
    
    if (!user) {
      setError('User not found. Please log in again.');
      setTimeout(() => router.push('/login'), 2000);
      return;
    }

    // Handle all possible user ID field names (API inconsistency)
    const userId = (user as any).user_id || (user as any).userId || user.id;
    
    if (!userId) {
      console.error('No user ID found in user object:', user);
      setError('User ID not found. Please log in again.');
      setTimeout(() => router.push('/login'), 2000);
      return;
    }

    console.log('Submitting security questions for user:', { userId, user });

    setIsLoading(true);

    try {
      const payload: any = {
        user_id: userId,
        questions: questions.map(q => ({
          question: q.question,
          answer: q.answer
        }))
      };

      // Include new password only if user has temp password
      if (showPasswordFields) {
        payload.new_password = newPassword;
      }

      console.log('Payload:', { ...payload, questions: payload.questions.map((q: any) => ({ ...q, answer: '[HIDDEN]' })) });

      const response = await apiClient.post(
        `/api/v1/users/${userId}/security-questions`,
        payload
      );

      console.log('Response:', response);

      setSuccess('Security questions set successfully! Redirecting...');
      
      // Clear the flag
      localStorage.removeItem('must_change_password');
      localStorage.removeItem('must_set_security_questions');

      // Redirect based on role
      setTimeout(() => {
        if (actualRole === 'super_admin') {
          router.push('/admin/global');
        } else if (actualRole === 'org_admin') {
          router.push('/admin/org');
        } else {
          router.push('/dashboard');
        }
      }, 1500);

    } catch (err: any) {
      console.error('Failed to set security questions:', err);
      console.error('Error response:', err.response);
      setError(err.response?.data?.message || err.message || 'Failed to set security questions');
    } finally {
      setIsLoading(false);
    }
  };

  const getAvailableQuestions = (currentIndex: number) => {
    const selectedQuestions = questions
      .map((q, i) => i !== currentIndex ? q.question : null)
      .filter(Boolean);
    
    return SECURITY_QUESTIONS.filter(q => !selectedQuestions.includes(q));
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Set Security Questions
          </h1>
          <p className="text-gray-600">
            {showPasswordFields 
              ? "Set up your security questions and create a permanent password"
              : "Set up your security questions for account recovery (one-time setup)"}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-800 text-sm">{success}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Security Questions */}
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Select and answer 3 security questions
            </h2>
            
            {questions.map((q, index) => (
              <div key={index} className="p-4 border border-gray-200 rounded-lg space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Question {index + 1}
                </label>
                <select
                  value={q.question}
                  onChange={(e) => handleQuestionChange(index, e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Select a question...</option>
                  {getAvailableQuestions(index).map((question) => (
                    <option key={question} value={question}>
                      {question}
                    </option>
                  ))}
                </select>

                {q.question && (
                  <input
                    type="text"
                    value={q.answer}
                    onChange={(e) => handleAnswerChange(index, e.target.value)}
                    placeholder="Your answer"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                )}
              </div>
            ))}
          </div>

          {/* Password Fields (only for new users) */}
          {showPasswordFields && (
            <div className="space-y-4 pt-6 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Create Your Permanent Password
              </h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 8 characters)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  minLength={8}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  minLength={8}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Saving...' : 'Save and Continue'}
          </button>
        </form>

        <p className="mt-6 text-xs text-gray-500 text-center">
          These security questions will be used to recover your account if you forget your password.
          <br />
          Please remember your answers.
        </p>
      </div>
    </div>
  );
}

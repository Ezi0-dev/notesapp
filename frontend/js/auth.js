import api from './api.js';
import { redirectIfAuthenticated, showSuccess, showError, updatePasswordStrength } from './utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Force re-login for existing users - clear any old localStorage tokens
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');

  // Redirect if already logged in (for login/register pages)
  if (window.location.pathname.includes('login.html') ||
      window.location.pathname.includes('register.html')) {
    await redirectIfAuthenticated();
  }

  // Register form
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    const passwordInput = document.getElementById('password');
    
    passwordInput.addEventListener('input', (e) => {
      updatePasswordStrength(e.target.value, 'passwordStrength');
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('username').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      
      if (password !== confirmPassword) {
        showError('errorMessage', 'Passwords do not match');
        return;
      }

      if (password.length < 8) {
        showError('errorMessage', 'Password must be at least 8 characters');
        return;
      }

      const registerBtn = document.getElementById('registerBtn');
      registerBtn.disabled = true;
      registerBtn.textContent = 'Registering...';

      try {
        const data = await api.register(username, email, password);

        // Only store user data in localStorage (tokens are in httpOnly cookies)
        localStorage.setItem('user', JSON.stringify(data.user));

        showSuccess('successMessage', 'Registration successful! Redirecting...');
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 1000);
      } catch (error) {
        showError('errorMessage', error.message);
        registerBtn.disabled = false;
        registerBtn.textContent = 'Register';
      }
    });
  }

  // Login form - UPDATED TO USE USERNAME
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Changed from email to username
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      
      const loginBtn = document.getElementById('loginBtn');
      loginBtn.disabled = true;
      loginBtn.textContent = 'Logging in...';

      try {
        // Call api.login with username instead of email
        const data = await api.login(username, password);

        // Only store user data in localStorage (tokens are in httpOnly cookies)
        localStorage.setItem('user', JSON.stringify(data.user));

        showSuccess('successMessage', 'Login successful! Redirecting...');
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 500);
      } catch (error) {
        showError('errorMessage', error.message);
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
      }
    });
  }
});
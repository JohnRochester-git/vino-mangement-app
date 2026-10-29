/* ==========================================================================
   Vino — Authentication & Account Management (auth.js)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  if (isOpenedAsFile()) return;

  // ---- DOM Elements ----
  const form = document.getElementById('loginForm');
  const usernameInput = document.getElementById('usernameInput');
  const usernameLabel = document.getElementById('usernameLabel');
  const passwordInput = document.getElementById('passwordInput');
  const passwordLabel = document.getElementById('passwordLabel');
  const nameRow = document.getElementById('nameRow');
  const firstNameInput = document.getElementById('firstNameInput');
  const lastNameInput = document.getElementById('lastNameInput');
  const togglePwdBtn = document.getElementById('togglePwdBtn');
  const eyeIcon = document.getElementById('eyeIcon');
  const submitBtn = document.getElementById('submitBtn');
  const btnSpinner = document.getElementById('btnSpinner');
  const btnText = document.getElementById('btnText');
  const arrowIcon = document.getElementById('arrowIcon');
  const alertBanner = document.getElementById('alertBanner');
  const alertText = document.getElementById('alertText');
  const forgotLink = document.getElementById('forgotLink');
  const toggleAuthMode = document.getElementById('toggleAuthMode');
  const authToggle = document.getElementById('authToggle');
  const cardHeaderLabel = document.querySelector('.card-header-label');

  // ---- Auth Mode State ----
  let isSignUpMode = false;

  // ---- Toggle between Sign In / Create Account ----
  function setupAuthToggle() {
    toggleAuthMode.addEventListener('click', function (e) {
      e.preventDefault();
      clearAlert();
      isSignUpMode = !isSignUpMode;

      if (isSignUpMode) {
        cardHeaderLabel.textContent = 'Create your cellar account';
        btnText.textContent = 'Create Account';
        authToggle.innerHTML = 'Already have an account? <a href="#" id="toggleAuthMode">Sign in</a>';
        usernameLabel.textContent = 'EMAIL';
        usernameInput.placeholder = 'you@email.com';
        usernameInput.type = 'email';
        passwordLabel.textContent = 'CREATE A PASSWORD';
        passwordInput.placeholder = 'Create a password';
        nameRow.classList.add('visible');
        firstNameInput.required = true;
        lastNameInput.required = true;
      } else {
        cardHeaderLabel.textContent = 'Sign in to your cellar';
        btnText.textContent = 'Sign In to Cellar';
        authToggle.innerHTML = 'Don\'t have an account? <a href="#" id="toggleAuthMode">Create one</a>';
        usernameLabel.textContent = 'EMAIL';
        usernameInput.placeholder = 'you@email.com';
        usernameInput.type = 'email';
        passwordLabel.textContent = 'PASSWORD';
        passwordInput.placeholder = '••••••••••••';
        nameRow.classList.remove('visible');
        firstNameInput.required = false;
        lastNameInput.required = false;
        firstNameInput.value = '';
        lastNameInput.value = '';
      }

      // Re-bind the dynamically rendered toggle button
      document.getElementById('toggleAuthMode').addEventListener('click', arguments.callee.bind(this));
    });
  }

  // ---- Toggle Password Visibility ----
  let isPwdVisible = false;
  if (togglePwdBtn) {
    togglePwdBtn.addEventListener('click', function () {
      isPwdVisible = !isPwdVisible;
      passwordInput.type = isPwdVisible ? 'text' : 'password';
      if (isPwdVisible) {
        eyeIcon.innerHTML = `
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        `;
        eyeIcon.setAttribute('stroke', '#C9A15B');
      } else {
        eyeIcon.innerHTML = `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        `;
        eyeIcon.setAttribute('stroke', 'currentColor');
      }
    });
  }

  // ---- Forgot Password Handler ----
  if (forgotLink) {
    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      showAlert('Password reset is not available. Please create a new account if you\'ve forgotten your credentials.', 'success');
    });
  }

  // ---- Alert Helpers ----
  function showAlert(msg, type = 'error') {
    alertBanner.className = 'alert-banner ' + type;
    alertBanner.style.display = '';
    alertText.textContent = msg;
  }

  function clearAlert() {
    alertBanner.className = 'alert-banner';
    alertBanner.style.display = 'none';
  }

  // ---- Already logged in? Skip straight to the welcome page ----
  getMe()
    .then(() => { window.location.href = 'welcome.html'; })
    .catch((err) => {
      if (err.status !== 401) showAlert(err.message);
    });

  // ---- Reset Button State Helper ----
  function resetButton() {
    submitBtn.disabled = false;
    btnSpinner.style.display = 'none';
    arrowIcon.style.display = '';
    btnText.textContent = isSignUpMode ? 'Create Account' : 'Sign In to Cellar';
  }

  // ---- Handle Form Submission ----
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearAlert();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();

    // Sign-up validations
    if (isSignUpMode) {
      if (!firstName) {
        showAlert('Please enter your first name.');
        firstNameInput.focus();
        return;
      }
      if (!lastName) {
        showAlert('Please enter your last name.');
        lastNameInput.focus();
        return;
      }
    }

    if (!username) {
      showAlert('Please enter your email.');
      usernameInput.focus();
      return;
    }

    // Email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      showAlert('Please enter a valid email address.');
      usernameInput.focus();
      return;
    }

    if (!password) {
      showAlert('Please enter your password.');
      passwordInput.focus();
      return;
    }

    if (password.length < 8) {
      showAlert('Password must be at least 8 characters.');
      passwordInput.focus();
      return;
    }

    // Show loading state
    submitBtn.disabled = true;
    btnSpinner.style.display = 'inline-block';
    arrowIcon.style.display = 'none';
    btnText.textContent = isSignUpMode ? 'Creating account...' : 'Authenticating...';

    try {
      if (isSignUpMode) {
        await signup(username, password, firstName, lastName);
        showAlert('Account created! Welcome, ' + firstName + '. Opening your cellar...', 'success');
      } else {
        const me = await login(username, password);
        showAlert('Welcome back, ' + me.user.userFname + '. Opening your cellar...', 'success');
      }
      btnText.textContent = 'Redirecting...';
      window.location.href = 'welcome.html';
    } catch (err) {
      // 401 wrong email/password, 409 email taken, 429 locked out: message is
      // written for users. 400: show the first field's message.
      showAlert(err.status === 400 ? firstErrorMessage(err) : err.message);
      resetButton();
    }
  });

  setupAuthToggle();
});

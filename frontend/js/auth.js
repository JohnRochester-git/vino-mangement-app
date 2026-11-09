/* ==========================================================================
   Vino — Authentication & Account Management (auth.js)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
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

  // ---- Simple password hashing (SHA-256 via SubtleCrypto) ----
  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

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
        usernameLabel.textContent = 'USERNAME OR EMAIL';
        usernameInput.placeholder = 'Your username';
        usernameInput.type = 'text';
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
    alertText.textContent = msg;
  }

  function clearAlert() {
    alertBanner.className = 'alert-banner';
    alertBanner.style.display = 'none';
  }

  // ---- Pre-fill remembered username ----
  const savedUser = getUserSession();
  if (savedUser && savedUser.username) {
    usernameInput.value = savedUser.username;
  }

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
      showAlert(isSignUpMode ? 'Please enter your email.' : 'Please enter your username.');
      usernameInput.focus();
      return;
    }

    // Email format check during sign-up
    if (isSignUpMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      showAlert('Please enter a valid email address.');
      usernameInput.focus();
      return;
    }

    if (!password) {
      showAlert('Please enter your password.');
      passwordInput.focus();
      return;
    }

    if (password.length < 4) {
      showAlert('Password must be at least 4 characters.');
      passwordInput.focus();
      return;
    }

    // Show loading state
    submitBtn.disabled = true;
    btnSpinner.style.display = 'inline-block';
    arrowIcon.style.display = 'none';
    btnText.textContent = isSignUpMode ? 'Creating account...' : 'Authenticating...';

    const passwordHash = await hashPassword(password);
    const accounts = getAccounts();

    // UX delay
    setTimeout(function () {
      if (isSignUpMode) {
        // ---- REGISTRATION ----
        const email = username.toLowerCase();
        const exists = accounts.find(a => a.email.toLowerCase() === email);
        if (exists) {
          showAlert('An account with that email already exists. Please sign in instead.');
          resetButton();
          return;
        }

        const displayName = firstName + ' ' + lastName;

        accounts.push({
          username: displayName,
          email: email,
          firstName: firstName,
          lastName: lastName,
          passwordHash: passwordHash
        });
        saveAccounts(accounts);

        // Create session and seed default cellar
        const session = {
          username: displayName,
          email: email,
          firstName: firstName,
          lastName: lastName,
          memberSince: new Date().toISOString().split('T')[0],
          loginTime: new Date().toISOString()
        };
        saveUserSession(session);
        loadCellar(); // Ensure default cellar exists

        showAlert('Account created! Welcome, ' + firstName + '. Opening your cellar...', 'success');
        btnText.textContent = 'Redirecting...';

        setTimeout(function () {
          window.location.href = 'welcome.html';
        }, 700);

      } else {
        // ---- LOGIN ----
        const loginQuery = username.toLowerCase();
        const account = accounts.find(a =>
          a.email.toLowerCase() === loginQuery ||
          a.username.toLowerCase() === loginQuery
        );

        if (!account) {
          showAlert('No account found. Please create an account first.');
          resetButton();
          return;
        }

        if (account.passwordHash !== passwordHash) {
          showAlert('Incorrect password. Please try again.');
          resetButton();
          return;
        }

        // Successful login — create session
        const session = {
          username: account.username,
          email: account.email,
          firstName: account.firstName || '',
          lastName: account.lastName || '',
          memberSince: account.memberSince || '2024-10-15',
          loginTime: new Date().toISOString()
        };
        saveUserSession(session);
        loadCellar(); // Ensure default cellar exists

        showAlert('Welcome back, ' + account.username + '. Opening your cellar...', 'success');
        btnText.textContent = 'Redirecting...';

        setTimeout(function () {
          window.location.href = 'welcome.html';
        }, 700);
      }
    }, 600);
  });

  setupAuthToggle();
});

/**
 * ブログ投稿アシスタント - Popup Script
 */

// DOM Elements
const elements = {
  // Setup Wizard
  setupWizard: document.getElementById('setupWizard'),
  step1: document.getElementById('step1'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  testResult: document.getElementById('testResult'),

  // Inputs
  wpUrl: document.getElementById('wpUrl'),
  wpUser: document.getElementById('wpUser'),
  wpPassword: document.getElementById('wpPassword'),
  wpToken: document.getElementById('wpToken'),

  // Errors
  urlError: document.getElementById('urlError'),
  userError: document.getElementById('userError'),
  passwordError: document.getElementById('passwordError'),

  // Buttons
  toStep2: document.getElementById('toStep2'),
  toStep3: document.getElementById('toStep3'),
  backToStep1: document.getElementById('backToStep1'),
  backToStep2: document.getElementById('backToStep2'),
  testConnection: document.getElementById('testConnection'),
  togglePassword: document.getElementById('togglePassword'),
  saveSettings: document.getElementById('saveSettings'),
  retrySetup: document.getElementById('retrySetup'),
  openGuide: document.getElementById('openGuide'),
  openGuidePassword: document.getElementById('openGuidePassword'),
  helpBtn: document.getElementById('helpBtn'),

  // Test Result
  testSuccess: document.getElementById('testSuccess'),
  testFailed: document.getElementById('testFailed'),
  connectedUrl: document.getElementById('connectedUrl'),
  connectedUser: document.getElementById('connectedUser'),
  testErrorMessage: document.getElementById('testErrorMessage'),
  errorHints: document.getElementById('errorHints'),

  // Main Screen
  mainScreen: document.getElementById('mainScreen'),
  currentUrl: document.getElementById('currentUrl'),
  openSettings: document.getElementById('openSettings'),
  reTestConnection: document.getElementById('reTestConnection'),
  autoCreateTerms: document.getElementById('autoCreateTerms'),

  // Loading
  loading: document.getElementById('loading')
};

// State
let currentStep = 1;
let tempConfig = {};

/**
 * Initialize popup
 */
async function init() {
  // Load saved settings
  const config = await chrome.storage.local.get(['wpUrl', 'wpUser', 'wpPassword', 'wpToken', 'settings']);

  if (config.wpUrl && config.wpUser && (config.wpPassword || config.wpToken)) {
    // Already configured - show main screen
    showMainScreen(config);
  } else {
    // Not configured - show setup wizard
    showStep(1);
  }

  // Setup event listeners
  setupEventListeners();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Navigation
  elements.toStep2.addEventListener('click', () => goToStep(2));
  elements.toStep3.addEventListener('click', () => goToStep(3));
  elements.backToStep1.addEventListener('click', () => goToStep(1));
  elements.backToStep2.addEventListener('click', () => goToStep(2));

  // Actions
  elements.testConnection.addEventListener('click', handleTestConnection);
  elements.saveSettings.addEventListener('click', handleSaveSettings);
  elements.retrySetup.addEventListener('click', () => goToStep(1));
  elements.togglePassword.addEventListener('click', togglePasswordVisibility);

  // Guide links
  elements.openGuide.addEventListener('click', openSetupGuide);
  elements.openGuidePassword.addEventListener('click', openSetupGuide);
  elements.helpBtn.addEventListener('click', openSetupGuide);

  // Main screen buttons
  elements.openSettings.addEventListener('click', () => {
    elements.mainScreen.style.display = 'none';
    elements.setupWizard.style.display = 'block';
    goToStep(1);
  });

  elements.reTestConnection.addEventListener('click', async () => {
    const config = await chrome.storage.local.get(['wpUrl', 'wpUser', 'wpPassword', 'wpToken']);
    tempConfig = config;
    await testConnection();
  });

  // Settings changes
  document.querySelectorAll('input[name="defaultStatus"]').forEach(radio => {
    radio.addEventListener('change', saveSettingsToStorage);
  });
  elements.autoCreateTerms.addEventListener('change', saveSettingsToStorage);

  // Input validation
  elements.wpUrl.addEventListener('input', () => clearError('url'));
  elements.wpUser.addEventListener('input', () => clearError('user'));
  elements.wpPassword.addEventListener('input', () => clearError('password'));
  elements.wpToken.addEventListener('input', () => clearError('password'));
}

/**
 * Show specific step
 */
function showStep(step) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const stepEl = document.getElementById(`step${step}`);
  if (stepEl) {
    stepEl.classList.add('active');
  }
  currentStep = step;
}

/**
 * Go to specific step with validation
 */
function goToStep(step) {
  // Validate current step before proceeding
  if (step > currentStep) {
    if (currentStep === 1 && !validateUrl()) return;
    if (currentStep === 2 && !validateUser()) return;
  }

  // Save temp values
  if (currentStep === 1) tempConfig.wpUrl = normalizeUrl(elements.wpUrl.value);
  if (currentStep === 2) tempConfig.wpUser = elements.wpUser.value.trim();
  if (currentStep === 3) {
    tempConfig.wpPassword = elements.wpPassword.value.trim();
    tempConfig.wpToken = elements.wpToken.value.trim();
  }

  showStep(step);
}

/**
 * Validate URL
 */
function validateUrl() {
  const url = elements.wpUrl.value.trim();

  if (!url) {
    showError('url', 'URLを入力してください');
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      showError('url', 'セキュリティのため、https:// で始まるURLを使用してください');
      return false;
    }
  } catch {
    showError('url', 'URLの形式が正しくありません');
    return false;
  }

  return true;
}

/**
 * Validate username
 */
function validateUser() {
  const user = elements.wpUser.value.trim();

  if (!user) {
    showError('user', 'ユーザー名を入力してください');
    return false;
  }

  return true;
}

/**
 * Validate password
 */
function validatePassword() {
  const password = elements.wpPassword.value.trim();
  const token = elements.wpToken.value.trim();

  if (!password && !token) {
    showError('password', 'パスワードまたはトークンを入力してください');
    return false;
  }

  return true;
}

/**
 * Normalize URL (remove trailing slash)
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.origin;
  } catch {
    return url.trim().replace(/\/$/, '');
  }
}

function getOriginPattern(url) {
  try {
    const origin = new URL(url.trim()).origin;
    return `${origin}/*`;
  } catch {
    return null;
  }
}

function checkOriginPermission(originPattern) {
  return new Promise(resolve => {
    chrome.permissions.contains({ origins: [originPattern] }, resolve);
  });
}

function requestOriginPermission(originPattern) {
  return new Promise(resolve => {
    chrome.permissions.request({ origins: [originPattern] }, resolve);
  });
}

async function ensureHostPermission(url) {
  const originPattern = getOriginPattern(url);
  if (!originPattern) {
    return { ok: false, message: 'URLの形式が正しくありません' };
  }

  const hasPermission = await checkOriginPermission(originPattern);
  if (hasPermission) {
    return { ok: true };
  }

  const granted = await requestOriginPermission(originPattern);
  if (!granted) {
    return { ok: false, message: 'このサイトへのアクセス権限が必要です' };
  }

  return { ok: true };
}

/**
 * Show error message
 */
function showError(field, message) {
  const errorEl = elements[`${field}Error`];
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
}

/**
 * Clear error message
 */
function clearError(field) {
  const errorEl = elements[`${field}Error`];
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.remove('show');
  }
}

/**
 * Handle test connection
 */
async function handleTestConnection() {
  if (!validatePassword()) return;

  tempConfig.wpPassword = elements.wpPassword.value.trim();
  tempConfig.wpToken = elements.wpToken.value.trim();
  await testConnection();
}

/**
 * Test connection to WordPress
 */
async function testConnection() {
  const permissionResult = await ensureHostPermission(tempConfig.wpUrl);
  if (!permissionResult.ok) {
    showTestFailure(permissionResult.message, [
      'ブラウザの許可ダイアログで「許可」を選択してください',
      'URLが正しいか確認してください'
    ]);
    return;
  }

  showLoading(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      data: tempConfig
    });

    showLoading(false);
    showStep('Result');
    elements.testResult.classList.add('active');

    if (response.success) {
      elements.testSuccess.style.display = 'block';
      elements.testFailed.style.display = 'none';
      elements.connectedUrl.textContent = new URL(tempConfig.wpUrl).hostname;
      elements.connectedUser.textContent = response.data.user || tempConfig.wpUser;
    } else {
      const hints = getErrorHints(response.error.code);
      showTestFailure(response.error.message, hints);
    }
  } catch (error) {
    showTestFailure('エラーが発生しました', [
      '拡張機能を再読み込みしてください'
    ]);
  }
}

function showTestFailure(message, hints) {
  showLoading(false);
  showStep('Result');
  elements.testResult.classList.add('active');
  elements.testSuccess.style.display = 'none';
  elements.testFailed.style.display = 'block';
  elements.testErrorMessage.textContent = message;
  elements.errorHints.innerHTML = hints.map(h => `<li>${h}</li>`).join('');
}

/**
 * Get error hints based on error code
 */
function getErrorHints(code) {
  const hints = {
    'AUTH_401': [
      'ユーザー名が正しいか確認してください',
      'アプリケーションパスワード（通常のログインパスワードではなく）を使用しているか確認してください',
      'パスワードをスペースを含めて正しくコピーしているか確認してください',
      'トークンを使っている場合は正しいトークンか確認してください',
      'レンタルサーバーのWAF等でAuthorizationがブロックされる場合は、トークンプラグイン方式（推奨）を使ってください'
    ],
    'AUTH_403': [
      'このユーザーに投稿権限があるか確認してください',
      'WordPress管理者に権限を確認してください'
    ],
    'NOT_FOUND_404': [
      'URLが正しいか確認してください',
      'WordPressのREST APIが有効か確認してください',
      'セキュリティプラグインがAPIをブロックしていないか確認してください'
    ],
    'NETWORK_ERROR': [
      'インターネット接続を確認してください',
      'サイトが正常に表示できるか確認してください'
    ]
  };

  return hints[code] || ['設定内容を確認してください'];
}

/**
 * Handle save settings
 */
async function handleSaveSettings() {
  const current = await chrome.storage.local.get(['settings']);
  const settings = current.settings || {};
  await chrome.storage.local.set({
    wpUrl: tempConfig.wpUrl,
    wpUser: tempConfig.wpUser,
    wpPassword: tempConfig.wpPassword,
    wpToken: tempConfig.wpToken,
    settings: {
      defaultStatus: settings.defaultStatus || 'draft',
      autoCreateTerms: settings.autoCreateTerms || false
    }
  });

  const config = await chrome.storage.local.get(['wpUrl', 'wpUser', 'wpPassword', 'wpToken', 'settings']);
  showMainScreen(config);
}

/**
 * Show main screen
 */
function showMainScreen(config) {
  elements.setupWizard.style.display = 'none';
  elements.mainScreen.style.display = 'block';
  elements.currentUrl.textContent = new URL(config.wpUrl).hostname;

  // Load settings
  if (config.settings) {
    document.querySelector(`input[name="defaultStatus"][value="${config.settings.defaultStatus || 'draft'}"]`).checked = true;
    elements.autoCreateTerms.checked = config.settings.autoCreateTerms || false;
  }

  // Pre-fill form for potential editing
  elements.wpUrl.value = config.wpUrl;
  elements.wpUser.value = config.wpUser;
  elements.wpPassword.value = config.wpPassword;
  elements.wpToken.value = config.wpToken || '';
  tempConfig = { ...config };
}

/**
 * Save settings to storage
 */
async function saveSettingsToStorage() {
  const defaultStatus = document.querySelector('input[name="defaultStatus"]:checked').value;
  const autoCreateTerms = elements.autoCreateTerms.checked;

  const current = await chrome.storage.local.get(['settings']);
  await chrome.storage.local.set({
    settings: {
      ...current.settings,
      defaultStatus,
      autoCreateTerms
    }
  });
}

/**
 * Toggle password visibility
 */
function togglePasswordVisibility() {
  const type = elements.wpPassword.type === 'password' ? 'text' : 'password';
  elements.wpPassword.type = type;
  elements.togglePassword.textContent = type === 'password' ? '👁' : '🙈';
}

/**
 * Open setup guide
 */
function openSetupGuide(e) {
  e.preventDefault();
  chrome.tabs.create({
    url: chrome.runtime.getURL('setup-guide/setup-guide.html')
  });
}

/**
 * Show/hide loading
 */
function showLoading(show) {
  elements.loading.style.display = show ? 'flex' : 'none';
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);

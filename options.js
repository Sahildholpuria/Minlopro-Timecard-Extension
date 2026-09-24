// options.js - Minlopro Timecard Extension Options Dashboard

// Browser environment compatibility shim for local testing & preview
if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
  const memStore = {};
  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: (keys, cb) => {
        const res = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        keyList.forEach(k => { res[k] = memStore[k]; });
        if (cb) setTimeout(() => cb(res), 0);
        return Promise.resolve(res);
      },
      set: (obj, cb) => {
        Object.assign(memStore, obj);
        if (cb) setTimeout(cb, 0);
        return Promise.resolve();
      },
      clear: (cb) => {
        Object.keys(memStore).forEach(k => delete memStore[k]);
        if (cb) setTimeout(cb, 0);
        return Promise.resolve();
      }
    }
  };
  window.chrome.runtime = window.chrome.runtime || {
    sendMessage: () => Promise.resolve(),
    onMessage: { addListener: () => {} }
  };
}

// DOM Pane Elements
const navItems = document.querySelectorAll('.nav-item');
const panes = document.querySelectorAll('.config-pane');

// Connection Elements
const authRadios = document.querySelectorAll('input[name="auth-mode"]');
const cookieCard = document.getElementById('cookie-settings-card');
const manualCard = document.getElementById('manual-settings-card');
const domainPatternInput = document.getElementById('domain-pattern');
const instanceUrlInput = document.getElementById('sf-instance-url');
const tokenInput = document.getElementById('sf-token');
const saveConnectionBtn = document.getElementById('save-connection-btn');

// Mappings Elements
const mapParentObj = document.getElementById('opt-parent-obj');
const mapChildObj = document.getElementById('opt-child-obj');
const mapParentResource = document.getElementById('opt-parent-resource');
const mapParentWeek = document.getElementById('opt-parent-week');
const mapParentStatus = document.getElementById('opt-parent-status');
const mapParentSentiment = document.getElementById('opt-parent-sentiment');
const mapParentFeedback = document.getElementById('opt-parent-feedback');
const mapAssignmentReport = document.getElementById('opt-assignment-report');

const mapChildParent = document.getElementById('opt-child-parent');
const mapChildProject = document.getElementById('opt-child-project');
const mapChildRole = document.getElementById('opt-child-role');
const mapChildDate = document.getElementById('opt-child-date');
const mapChildHours = document.getElementById('opt-child-hours');
const mapChildDesc = document.getElementById('opt-child-desc');
const mapChildNonBillable = document.getElementById('opt-child-non-billable');
const saveMappingsBtn = document.getElementById('save-mappings-btn');

// Diagnostics & Theme Elements
const toggleMockBtn = document.getElementById('toggle-mock-btn');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const toastContainer = document.getElementById('toast-container');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeBtnLabel = document.getElementById('theme-btn-label');

// State
let mockModeEnabled = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupConnectionToggles();
  loadSettings();
  
  saveConnectionBtn.addEventListener('click', saveConnectionSettings);
  saveMappingsBtn.addEventListener('click', saveFieldMappings);
  toggleMockBtn.addEventListener('click', toggleMockMode);
  clearCacheBtn.addEventListener('click', clearExtensionStorage);
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }
});

// Sidebar Navigation Pane switching
function setupNavigation() {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetPane = item.dataset.pane;
      
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      
      item.classList.add('active');
      document.getElementById(targetPane).classList.add('active');
    });
  });
}

// Authentication radio toggling
function setupConnectionToggles() {
  authRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'cookie') {
        cookieCard.classList.remove('hidden');
        manualCard.classList.add('hidden');
      } else {
        manualCard.classList.remove('hidden');
        cookieCard.classList.add('hidden');
      }
    });
  });
}

// Load Settings from Chrome Storage
function loadSettings() {
  chrome.storage.local.get(['sfSettings', 'fieldMappings', 'mockModeForce', 'theme'], (result) => {
    // 0. Theme
    initTheme(result.theme || 'dark');

    // 1. Connection
    if (result.sfSettings) {
      const settings = result.sfSettings;
      const authVal = settings.authMethod || 'cookie';
      
      authRadios.forEach(r => {
        if (r.value === authVal) {
          r.checked = true;
          r.dispatchEvent(new Event('change'));
        }
      });
      
      domainPatternInput.value = settings.domainPattern || '';
      instanceUrlInput.value = settings.instanceUrl || '';
      tokenInput.value = settings.accessToken || '';
    }
    
    // 2. Mappings
    if (result.fieldMappings) {
      const mappings = result.fieldMappings;
      mapParentObj.value = mappings.parentObject || 'Timecard__c';
      mapChildObj.value = mappings.childObject || 'Timecard_Entry__c';
      mapParentResource.value = mappings.parentResource || 'Timecard_For__c';
      mapParentWeek.value = mappings.parentWeek || 'Week_of__c';
      mapParentStatus.value = mappings.parentStatus || 'Status__c';
      mapParentSentiment.value = mappings.parentSentiment || 'Weekly_Sentiment__c';
      if (mapParentFeedback) {
        mapParentFeedback.value = mappings.parentFeedback || 'Workload_Feedback__c';
      }
      if (mapAssignmentReport) {
        mapAssignmentReport.value = mappings.assignmentReport || 'P-RAP Resource Assignment by Pro';
      }
      
      mapChildParent.value = mappings.childParent || 'Timecard__c';
      mapChildProject.value = mappings.childProject || 'Project__c';
      mapChildRole.value = mappings.childRole || 'Project_Role__c';
      mapChildDate.value = mappings.childDate || 'Date__c';
      mapChildHours.value = mappings.childHours || 'Hours__c';
      mapChildDesc.value = mappings.childDesc || 'Task_Description__c';
      mapChildNonBillable.value = mappings.childNonBillable || 'Non_Billable__c';
    }

    // 3. Mock Mode Force
    if (result.mockModeForce) {
      mockModeEnabled = true;
      toggleMockBtn.innerText = 'Disable Mock Mode';
      toggleMockBtn.className = 'btn btn-primary';
    } else {
      mockModeEnabled = false;
      toggleMockBtn.innerText = 'Enable Mock Mode';
      toggleMockBtn.className = 'btn btn-secondary';
    }
  });
}

// Save Connection
function saveConnectionSettings() {
  const selectedAuth = document.querySelector('input[name="auth-mode"]:checked').value;
  const domainPattern = domainPatternInput.value.trim();
  const instanceUrl = instanceUrlInput.value.trim();
  const token = tokenInput.value.trim();

  if (selectedAuth === 'manual' && (!instanceUrl || !token)) {
    showToast('Please enter both Instance URL and Access Token for manual connection.', 'error');
    return;
  }

  const sfSettings = {
    authMethod: selectedAuth,
    domainPattern: domainPattern,
    instanceUrl: instanceUrl,
    accessToken: token
  };

  chrome.storage.local.set({ sfSettings }, () => {
    showToast('Connection settings saved successfully!', 'success');
  });
}

// Save Mappings
function saveFieldMappings() {
  const mappings = {
    parentObject: mapParentObj.value.trim(),
    childObject: mapChildObj.value.trim(),
    parentResource: mapParentResource.value.trim(),
    parentWeek: mapParentWeek.value.trim(),
    parentStatus: mapParentStatus.value.trim(),
    parentSentiment: mapParentSentiment.value.trim(),
    parentFeedback: mapParentFeedback ? mapParentFeedback.value.trim() : 'Workload_Feedback__c',
    assignmentReport: mapAssignmentReport ? mapAssignmentReport.value.trim() : 'P-RAP Resource Assignment by Pro',
    childParent: mapChildParent.value.trim(),
    childProject: mapChildProject.value.trim(),
    childRole: mapChildRole.value.trim(),
    childDate: mapChildDate.value.trim(),
    childHours: mapChildHours.value.trim(),
    childDesc: mapChildDesc.value.trim(),
    childNonBillable: mapChildNonBillable.value.trim()
  };

  chrome.storage.local.set({ fieldMappings: mappings }, () => {
    showToast('Field mappings updated successfully!', 'success');
  });
}

// Theme Handling
function initTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    if (themeBtnLabel) themeBtnLabel.innerText = 'Dark Theme';
  } else {
    document.body.classList.remove('light-theme');
    if (themeBtnLabel) themeBtnLabel.innerText = 'Light Theme';
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  const newTheme = isLight ? 'light' : 'dark';
  chrome.storage.local.set({ theme: newTheme });
  if (themeBtnLabel) {
    themeBtnLabel.innerText = isLight ? 'Dark Theme' : 'Light Theme';
  }
}

// Toggle Mock Mode
function toggleMockMode() {
  mockModeEnabled = !mockModeEnabled;
  chrome.storage.local.set({ mockModeForce: mockModeEnabled }, () => {
    if (mockModeEnabled) {
      toggleMockBtn.innerText = 'Disable Mock Mode';
      toggleMockBtn.className = 'btn btn-primary';
      showToast('Mock Mode forced enabled. Reload popup to apply.', 'info');
    } else {
      toggleMockBtn.innerText = 'Enable Mock Mode';
      toggleMockBtn.className = 'btn btn-secondary';
      showToast('Mock Mode disabled. Re-evaluating standard connections.', 'info');
    }
  });
}

// Reset Extension Storage
function clearExtensionStorage() {
  if (confirm('Are you sure you want to completely clear extension local storage? This deletes all saved drafts, history cache, and configuration settings.')) {
    chrome.storage.local.clear(() => {
      showToast('Extension storage cleared successfully.', 'success');
      // Reload defaults
      setTimeout(() => location.reload(), 1000);
    });
  }
}

// Toast Helper
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

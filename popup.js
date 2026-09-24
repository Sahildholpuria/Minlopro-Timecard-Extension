// popup.js - Minlopro Timecard Extension Popup Logic (Redesigned Flow)

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

// State Management
let state = {
  sfConnected: false,
  sfUser: null,
  sfInstanceUrl: '',
  sfAccessToken: '',
  authMethod: 'cookie',
  fieldMappings: {},
  mockMode: false,
  saving: false,
  
  // Redesigned Flow state
  availableTimecards: [],   // Timecards loaded from Salesforce
  selectedTimecardId: '',   // Locked parent Timecard ID
  selectedTimecard: null,   // Selected Timecard record details
  selectedProjectId: '',    // Chosen Project ID
  selectedProjectName: '',  // Chosen Project Name
  selectedRoleId: '',       // Chosen Role ID
  selectedRoleName: '',     // Chosen Role Name
  editMode: false,          // Edit Mode indicator
  editingGroupIds: null,    // Active IDs of entries under edit
  
  projectReferencedSObject: 'Project__c',
  roleReferencedSObject: 'Project_Role__c',
  roleFields: null,
  
  currentEntries: [],       // Logged child entries for active week
  entryHours: [0, 0, 0, 0, 0, 0, 0] // Temp hours for new entry: M, T, W, T, F, S, S
};

// Mock Database for Offline Testing / Developer Demo
const MOCK_DATA = {
  user: {
    Id: '00580000003xpLqAAI',
    Name: 'Sahil Dholpuria',
    Email: 'sahil@mycompany.com'
  },
  timecards: [
    { Id: 'tc_001', Name: 'Sahil Dholpuria | Week of 2026-06-22', WeekOf: '2026-06-22', Status: 'Draft', TotalHours: 0.0, Sentiment: '', Feedback: '' },
    { Id: 'tc_002', Name: 'Sahil Dholpuria | Week of 2026-06-15', WeekOf: '2026-06-15', Status: 'Submitted', TotalHours: 40.0, Sentiment: 'Balanced – I’m good with the workload', Feedback: 'Everything went smoothly.' },
    { Id: 'tc_003', Name: 'Sahil Dholpuria | Week of 2026-06-08', WeekOf: '2026-06-08', Status: 'Approved', TotalHours: 42.5, Sentiment: 'Ready for more – I have capacity to take on more', Feedback: 'Finished early.' }
  ],
  projects: [
    { Id: 'proj_001', Name: 'Alpha Project - Phase 1' },
    { Id: 'proj_002', Name: 'Beta Client - Support Services' },
    { Id: 'proj_003', Name: 'Gamma Implementation' },
    { Id: 'proj_004', Name: 'Delta Consultation & Advisory' },
    { Id: 'proj_005', Name: 'Internal Overhead / Operations' }
  ],
  roles: {
    'proj_001': [
      { Id: 'role_001', Name: 'Lead QA Consultant' },
      { Id: 'role_002', Name: 'Automation Engineer' }
    ],
    'proj_002': [
      { Id: 'role_003', Name: 'Business Analyst' },
      { Id: 'role_004', Name: 'QA Analyst' }
    ],
    'proj_003': [
      { Id: 'role_005', Name: 'Technical Architect' },
      { Id: 'role_006', Name: 'Consultant' }
    ],
    'default': [
      { Id: 'role_007', Name: 'Associate Resource' },
      { Id: 'role_008', Name: 'Support Engineer' }
    ]
  },
  entries: {
    'tc_001': [], // Start empty for logging
    'tc_002': [
      { Id: 'e_001', ProjectId: 'proj_001', ProjectName: 'Alpha Project - Phase 1', RoleId: 'role_001', RoleName: 'Lead QA Consultant', Date: '2026-06-15', Hours: 8.0, Description: 'Test plan creation', NonBillable: false },
      { Id: 'e_002', ProjectId: 'proj_001', ProjectName: 'Alpha Project - Phase 1', RoleId: 'role_001', RoleName: 'Lead QA Consultant', Date: '2026-06-16', Hours: 8.0, Description: 'Execution mock runs', NonBillable: false }
    ],
    'tc_003': []
  }
};

// Utilities
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts.map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateStr);
}

// DOM Elements Reference Shell
const DOM = {};

function initDOMElements() {
  DOM.connectionStatus = document.getElementById('connection-status');
  DOM.timecardSelect = document.getElementById('timecard-select');
  DOM.selectedTimecardInfo = document.getElementById('selected-timecard-info');
  DOM.cardWeekDate = document.getElementById('card-week-date');
  DOM.cardStatusBadge = document.getElementById('card-status-badge');
  DOM.cardTotalHours = document.getElementById('card-total-hours');
  
  // Entry Form
  DOM.entryFormContainer = document.getElementById('entry-form-container');
  DOM.entryProject = document.getElementById('entry-project');
  DOM.entryProjectList = document.getElementById('entry-project-list');
  DOM.entryRole = document.getElementById('entry-role');
  DOM.entryRoleList = document.getElementById('entry-role-list');
  DOM.entryDescription = document.getElementById('entry-description');
  DOM.entryNonBillable = document.getElementById('entry-non-billable');
  DOM.bubbleInputs = document.querySelectorAll('.bubble-input');
  DOM.entryTotalHours = document.getElementById('entry-total-hours');
  DOM.saveEntryBtn = document.getElementById('save-entry-btn');
  DOM.cancelEditBtn = document.getElementById('cancel-edit-btn');
  
  // Logged list
  DOM.loggedEntriesContainer = document.getElementById('logged-entries-container');
  DOM.loggedEntriesList = document.getElementById('logged-entries-list');
  
  // Submit
  DOM.sentimentSubmitContainer = document.getElementById('sentiment-submit-container');
  DOM.sentimentSelect = document.getElementById('sentiment-select');
  DOM.feedbackNotes = document.getElementById('feedback-notes');
  DOM.saveTimecardBtn = document.getElementById('save-timecard-btn');
  DOM.submitTimecardBtn = document.getElementById('submit-timecard-btn');
  
  // Other tabs
  DOM.tabButtons = document.querySelectorAll('.tab-btn');
  DOM.tabPanes = document.querySelectorAll('.tab-pane');
  DOM.toastContainer = document.getElementById('toast-container');
  DOM.refreshHistoryBtn = document.getElementById('refresh-history-btn');
  DOM.historyList = document.getElementById('history-list');
  
  // Settings Tab
  DOM.authCookieBtn = document.getElementById('auth-cookie-btn');
  DOM.authManualBtn = document.getElementById('auth-manual-btn');
  DOM.cookieConfig = document.getElementById('cookie-config-container');
  DOM.manualConfig = document.getElementById('manual-config-container');
  DOM.sfInstanceDomain = document.getElementById('sf-instance-domain');
  DOM.detectSessionBtn = document.getElementById('detect-session-btn');
  DOM.sfEndpoint = document.getElementById('sf-endpoint');
  DOM.sfAccessTokenInput = document.getElementById('sf-access-token');
  DOM.saveManualBtn = document.getElementById('save-manual-btn');
  DOM.autoDetectMappingsBtn = document.getElementById('auto-detect-mappings-btn');
  DOM.saveMappingsBtn = document.getElementById('save-mappings-btn');
  
  // Mappings
  DOM.mapParentObj = document.getElementById('map-parent-object');
  DOM.mapChildObj = document.getElementById('map-child-object');
  DOM.mapParentResource = document.getElementById('map-parent-resource');
  DOM.mapParentWeek = document.getElementById('map-parent-week');
  DOM.mapParentStatus = document.getElementById('map-parent-status');
  DOM.mapParentSentiment = document.getElementById('map-parent-sentiment');
  DOM.mapParentFeedback = document.getElementById('map-parent-feedback');
  DOM.mapChildParent = document.getElementById('map-child-parent');
  DOM.mapChildProject = document.getElementById('map-child-project');
  DOM.mapChildRole = document.getElementById('map-child-role');
  DOM.mapChildDate = document.getElementById('map-child-date');
  DOM.mapChildHours = document.getElementById('map-child-hours');
  DOM.mapChildDesc = document.getElementById('map-child-desc');
  DOM.mapChildNonBillable = document.getElementById('map-child-non-billable');
  DOM.themeToggleBtn = document.getElementById('theme-toggle-btn');
}

// Initial Setup
document.addEventListener('DOMContentLoaded', async () => {
  initDOMElements();
  initTheme();
  setupTabs();
  setupSettingsToggles();
  await loadFieldMappings();
  
  // Timecard selection listener
  DOM.timecardSelect.addEventListener('change', onTimecardSelected);
  
  // Hours bubble change listeners
  DOM.bubbleInputs.forEach(input => {
    input.addEventListener('input', updateEntrySum);
  });
  
  // Project / Role Autocomplete wiring
  setupFormAutocomplete();

  // Save Entry click
  DOM.saveEntryBtn.addEventListener('click', saveTimecardEntry);
  DOM.cancelEditBtn.addEventListener('click', cancelEditing);

  // Submit Timecard click
  DOM.saveTimecardBtn.addEventListener('click', saveTimecardParentRecord);
  DOM.submitTimecardBtn.addEventListener('click', submitTimecardRecord);

  // Refresh history click
  DOM.refreshHistoryBtn.addEventListener('click', loadHistory);

  // Listen for background updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SF_SESSION_CHANGED') {
      showToast('Salesforce Session Cookie updated. Reconnecting...', 'info');
      initConnection();
    }
  });

  // Load connection config & connect
  await initConnection();
});

// Setup Tab Navigation
function setupTabs() {
  DOM.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      
      DOM.tabButtons.forEach(b => b.classList.remove('active'));
      DOM.tabPanes.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const activePane = document.getElementById(tabName);
      if (activePane) activePane.classList.add('active');
      
      if (tabName === 'history') {
        loadHistory();
      }
    });
  });
}

// Toggle settings modes
function setupSettingsToggles() {
  DOM.authCookieBtn.addEventListener('click', () => {
    DOM.authCookieBtn.classList.add('active');
    DOM.authManualBtn.classList.remove('active');
    DOM.cookieConfig.classList.remove('hidden');
    DOM.manualConfig.classList.add('hidden');
    state.authMethod = 'cookie';
  });

  DOM.authManualBtn.addEventListener('click', () => {
    DOM.authManualBtn.classList.add('active');
    DOM.authCookieBtn.classList.remove('active');
    DOM.manualConfig.classList.remove('hidden');
    DOM.cookieConfig.classList.add('hidden');
    state.authMethod = 'manual';
  });

  DOM.detectSessionBtn.addEventListener('click', () => detectCookieSession());
  DOM.saveManualBtn.addEventListener('click', () => saveManualCredentials());
  DOM.saveMappingsBtn.addEventListener('click', () => saveFieldMappings());
  DOM.autoDetectMappingsBtn.addEventListener('click', () => autoDetectMappings());
}

// Load configurations from Chrome Storage
function loadFieldMappings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['fieldMappings', 'sfSettings'], (result) => {
      // Merge with default mappings to prevent undefined fields
      state.fieldMappings = Object.assign({
        parentObject: 'Timecard__c',
        childObject: 'Timecard_Entry__c',
        parentResource: 'Timecard_For__c',
        parentWeek: 'Week_of__c',
        parentStatus: 'Status__c',
        parentSentiment: 'Weekly_Sentiment__c',
        parentFeedback: 'Workload_Feedback__c',
        childParent: 'Timecard__c',
        childProject: 'Project__c',
        childRole: 'Project_Role__c',
        childDate: 'Date__c',
        childHours: 'Hours__c',
        childDesc: 'Task_Description__c',
        childNonBillable: 'Non_Billable__c'
      }, result.fieldMappings || {});

      // Update UI mapping inputs
      DOM.mapParentObj.value = state.fieldMappings.parentObject;
      DOM.mapChildObj.value = state.fieldMappings.childObject;
      DOM.mapParentResource.value = state.fieldMappings.parentResource;
      DOM.mapParentWeek.value = state.fieldMappings.parentWeek;
      DOM.mapParentStatus.value = state.fieldMappings.parentStatus;
      DOM.mapParentSentiment.value = state.fieldMappings.parentSentiment;
      if (DOM.mapParentFeedback) {
        DOM.mapParentFeedback.value = state.fieldMappings.parentFeedback || 'Workload_Feedback__c';
      }
      DOM.mapChildParent.value = state.fieldMappings.childParent;
      DOM.mapChildProject.value = state.fieldMappings.childProject;
      DOM.mapChildRole.value = state.fieldMappings.childRole;
      DOM.mapChildDate.value = state.fieldMappings.childDate;
      DOM.mapChildHours.value = state.fieldMappings.childHours;
      DOM.mapChildDesc.value = state.fieldMappings.childDesc;
      DOM.mapChildNonBillable.value = state.fieldMappings.childNonBillable || 'Non_Billable__c';

      if (result.sfSettings) {
        const settings = result.sfSettings;
        state.authMethod = settings.authMethod || 'cookie';
        state.sfInstanceUrl = settings.instanceUrl || '';
        state.sfAccessToken = settings.accessToken || '';
        DOM.sfInstanceDomain.value = settings.domainPattern || '';
        DOM.sfEndpoint.value = settings.instanceUrl || '';
        DOM.sfAccessTokenInput.value = settings.accessToken || '';
        
        if (state.authMethod === 'manual') {
          DOM.authManualBtn.click();
        } else {
          DOM.authCookieBtn.click();
        }
      } else {
        // Defaults to cookie capturing mode
        state.authMethod = 'cookie';
        DOM.authCookieBtn.click();
      }

      resolve();
    });
  });
}

// Initialize Connection
async function initConnection() {
  updateStatus('syncing', 'Connecting...');
  
  if (state.authMethod === 'cookie') {
    await detectCookieSession(true);
  } else {
    await validateConnection(state.sfInstanceUrl, state.sfAccessToken);
  }

  if (!state.sfConnected) {
    enableMockMode();
  }
}

// Enable Mock Mode for Offline Use
function enableMockMode() {
  state.mockMode = true;
  state.sfConnected = true;
  state.sfUser = MOCK_DATA.user;
  
  updateStatus('connected', 'Offline Mock Mode');
  showToast('Salesforce disconnected. Running in offline Mock Mode!', 'warning');
  
  loadAvailableTimecards();
}

// Load Available Timecards to Selector Dropdown
async function loadAvailableTimecards() {
  DOM.timecardSelect.innerHTML = '<option value="">-- Load & Select Timecard --</option>';
  
  if (state.mockMode) {
    // Populate mock options
    state.availableTimecards = [...MOCK_DATA.timecards];
    populateTimecardDropdown(state.availableTimecards);
    return;
  }

  // Resolve lookup target objects for Projects and Roles
  await resolveLookupSObjects();

  try {
    updateStatus('syncing', 'Loading weekly Timecards...');
    const pObj = state.fieldMappings.parentObject || 'Timecard__c';
    const parentResourceField = state.fieldMappings.parentResource || 'Timecard_For__c';

    let resourceIds = [state.sfUser.Id]; // Default to current User ID
    let hasOwnerId = false;

    // Describe parent Timecard SObject to determine the relationship target and fields
    try {
      const describeRes = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${pObj}/describe`, {
        headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
      });
      
      if (describeRes.ok) {
        const meta = await describeRes.json();
        validateAndAlignParentMappings(meta.fields || []);
        populateSentimentPicklist(meta.fields || []);
        hasOwnerId = meta.fields.some(f => f.name === 'OwnerId');
        
        const lookupField = meta.fields.find(f => f.name === parentResourceField);
        if (lookupField && lookupField.type === 'reference' && lookupField.referenceTo && lookupField.referenceTo.length > 0) {
          const targetSObject = lookupField.referenceTo[0];
          console.log(`Timecard_For__c references SObject: ${targetSObject}`);
          
          if (targetSObject !== 'User') {
            // Lookup target is NOT a User (e.g. Contact, Resource__c etc.)
            // We search for matching record(s) on the resource target object by Name and User lookup
            let lookupQuery = `SELECT Id FROM ${targetSObject} WHERE Name = '${state.sfUser.Name}'`;
            
            // Inspect the target resource object describe to find User lookup fields
            const targetDescribeRes = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${targetSObject}/describe`, {
              headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
            });
            
            if (targetDescribeRes.ok) {
              const targetMeta = await targetDescribeRes.json();
              const userLookup = targetMeta.fields.find(f => 
                f.type === 'reference' && 
                f.referenceTo.includes('User') && 
                (f.name.toLowerCase().includes('user') || f.name.toLowerCase().includes('salesforce'))
              );
              if (userLookup) {
                lookupQuery += ` OR ${userLookup.name} = '${state.sfUser.Id}'`;
              }
            }
            
            const lookupUrl = `${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(lookupQuery)}`;
            const lookupRes = await fetch(lookupUrl, {
              headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
            });
            
            if (lookupRes.ok) {
              const lookupData = await lookupRes.json();
              if (lookupData.records && lookupData.records.length > 0) {
                resourceIds = lookupData.records.map(r => r.Id);
                console.log(`Resolved Employee Resource IDs:`, resourceIds);
              }
            }
          }
        }
      }
    } catch (describeErr) {
      console.warn('Metadata describe query failed, falling back to direct ID check:', describeErr);
    }

    // Build the query filter for pre-created Timecards
    const resourceFilter = resourceIds.map(id => `'${id}'`).join(',');
    let queryWhere = `${parentResourceField} IN (${resourceFilter}) OR CreatedById = '${state.sfUser.Id}'`;
    if (hasOwnerId) {
      queryWhere += ` OR OwnerId = '${state.sfUser.Id}'`;
    }

    // Query weekly parent Timecards
    const sentimentField = state.fieldMappings.parentSentiment ? `, ${state.fieldMappings.parentSentiment}` : '';
    const feedbackField = state.fieldMappings.parentFeedback ? `, ${state.fieldMappings.parentFeedback}` : '';
    const query = `SELECT Id, Name, ${state.fieldMappings.parentWeek}, ${state.fieldMappings.parentStatus}${sentimentField}${feedbackField} FROM ${pObj} WHERE ${queryWhere} ORDER BY ${state.fieldMappings.parentWeek} DESC LIMIT 15`;
    const url = `${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      state.availableTimecards = (data.records || []).map(r => ({
        Id: r.Id,
        Name: r.Name || `Timecard | Week of ${r[state.fieldMappings.parentWeek]}`,
        WeekOf: r[state.fieldMappings.parentWeek],
        Status: r[state.fieldMappings.parentStatus] || 'Draft',
        Sentiment: state.fieldMappings.parentSentiment ? r[state.fieldMappings.parentSentiment] : '',
        Feedback: state.fieldMappings.parentFeedback ? r[state.fieldMappings.parentFeedback] : '',
        TotalHours: 0.0 // loaded dynamically
      }));
      
      populateTimecardDropdown(state.availableTimecards);
      updateStatus('connected', 'Connected');
    } else {
      showToast('Failed to load Timecards from Salesforce.', 'error');
      updateStatus('connected', 'Connected');
    }
  } catch (err) {
    console.error('Error loading timecards:', err);
    showToast('Network error loading timecard records.', 'error');
    updateStatus('connected', 'Error');
  }
}

function populateTimecardDropdown(timecards) {
  if (timecards.length === 0) {
    DOM.timecardSelect.innerHTML = '<option value="">No pre-created timecards found</option>';
    return;
  }

  timecards.forEach(tc => {
    const opt = document.createElement('option');
    opt.value = tc.Id;
    opt.innerText = `${tc.Status.toUpperCase()} - Week of ${tc.WeekOf}`;
    DOM.timecardSelect.appendChild(opt);
  });
}

// On select Timecard change handler
async function onTimecardSelected() {
  const selectedId = DOM.timecardSelect.value;
  state.selectedTimecardId = selectedId;
  
  if (!selectedId) {
    // Lock Panels
    DOM.selectedTimecardInfo.classList.add('hidden');
    DOM.entryFormContainer.classList.add('disabled-panel');
    DOM.loggedEntriesContainer.classList.add('disabled-panel');
    DOM.sentimentSubmitContainer.classList.add('disabled-panel');
    state.selectedTimecard = null;
    clearEntryForm();
    return;
  }

  // Find Timecard object details
  state.selectedTimecard = state.availableTimecards.find(tc => tc.Id === selectedId);
  
  // Populate existing sentiment/feedback if present
  if (state.fieldMappings.parentSentiment) {
    DOM.sentimentSelect.value = state.selectedTimecard.Sentiment || '';
    const parentGp = DOM.sentimentSelect.closest('.form-group');
    if (parentGp) parentGp.style.display = 'block';
  } else {
    DOM.sentimentSelect.value = '';
    const parentGp = DOM.sentimentSelect.closest('.form-group');
    if (parentGp) parentGp.style.display = 'none';
  }

  if (state.fieldMappings.parentFeedback) {
    DOM.feedbackNotes.value = state.selectedTimecard.Feedback || '';
    const parentGp = DOM.feedbackNotes.closest('.form-group');
    if (parentGp) parentGp.style.display = 'block';
  } else {
    DOM.feedbackNotes.value = '';
    const parentGp = DOM.feedbackNotes.closest('.form-group');
    if (parentGp) parentGp.style.display = 'none';
  }

  // Render labels with actual dates of the week
  updateHoursBubbleDates(state.selectedTimecard.WeekOf);
  
  // Update Info card UI
  DOM.cardWeekDate.innerText = state.selectedTimecard.WeekOf;
  updateStatusBadge(state.selectedTimecard.Status);
  DOM.selectedTimecardInfo.classList.remove('hidden');

  // Unlock panels
  DOM.entryFormContainer.classList.remove('disabled-panel');
  DOM.loggedEntriesContainer.classList.remove('disabled-panel');
  
  // Only unlock sentiment submit if timecard is still Draft / Open
  if (state.selectedTimecard.Status === 'Draft') {
    DOM.sentimentSubmitContainer.classList.remove('disabled-panel');
    DOM.saveEntryBtn.disabled = false;
    DOM.saveTimecardBtn.disabled = false;
    DOM.submitTimecardBtn.disabled = false;
  } else {
    DOM.sentimentSubmitContainer.classList.add('disabled-panel');
    DOM.saveEntryBtn.disabled = true;
    DOM.saveTimecardBtn.disabled = true;
    DOM.submitTimecardBtn.disabled = true;
    showToast(`Timecard has already been ${state.selectedTimecard.Status}. Read-only mode active.`, 'warning');
  }

  // Load existing entries list for this parent Timecard
  await loadLoggedEntries();
}

function updateStatusBadge(status) {
  DOM.cardStatusBadge.className = `badge ${status.toLowerCase()}`;
  DOM.cardStatusBadge.innerText = status;
}

// Render Mon-Sun bubble headers with explicit dates
function updateHoursBubbleDates(weekStartStr) {
  if (!weekStartStr) return;
  const baseDate = parseLocalDate(weekStartStr);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + i);
    const month = d.getMonth() + 1;
    const date = d.getDate();

    const dateSpan = document.getElementById(`day-date-${i}`);
    if (dateSpan) {
      dateSpan.innerText = `${month}/${date}`;
    } else {
      const lbl = document.getElementById(`day-lbl-${i}`);
      if (lbl) {
        lbl.innerText = `${dayNames[i]} ${month}/${date}`;
      }
    }
  }
}

// Setup Projects / Roles autocompletes
function setupFormAutocomplete() {
  // Project Search typing
  DOM.entryProject.addEventListener('input', async (e) => {
    const term = e.target.value.trim();
    if (term.length < 2) {
      DOM.entryProjectList.classList.add('hidden');
      return;
    }

    const projects = await searchSFRecords(state.projectReferencedSObject || 'Project__c', term);
    DOM.entryProjectList.innerHTML = '';
    
    if (projects.length > 0) {
      DOM.entryProjectList.classList.remove('hidden');
      projects.forEach(p => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerText = p.Name;
        item.addEventListener('click', () => {
          DOM.entryProject.value = p.Name;
          state.selectedProjectId = p.Id;
          state.selectedProjectName = p.Name;
          DOM.entryProjectList.classList.add('hidden');
          
          // Unlock & Enable Role Lookup
          DOM.entryRole.disabled = false;
          DOM.entryRole.placeholder = 'Search associated roles...';
          DOM.entryRole.value = '';
          state.selectedRoleId = '';
          state.selectedRoleName = '';
        });
        DOM.entryProjectList.appendChild(item);
      });
    } else {
      DOM.entryProjectList.classList.add('hidden');
    }
  });

  // Project Role search typing
  DOM.entryRole.addEventListener('input', async (e) => {
    const term = e.target.value.trim();
    if (term.length < 2) {
      DOM.entryRoleList.classList.add('hidden');
      return;
    }

    // Pass project ID as query filter
    const roles = await searchRoleRecords(state.roleReferencedSObject || 'Project_Role__c', term, state.selectedProjectId);
    DOM.entryRoleList.innerHTML = '';

    if (roles.length > 0) {
      DOM.entryRoleList.classList.remove('hidden');
      roles.forEach(r => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerText = r.Name;
        item.addEventListener('click', () => {
          DOM.entryRole.value = r.Name;
          state.selectedRoleId = r.Id;
          state.selectedRoleName = r.Name;
          DOM.entryRoleList.classList.add('hidden');
        });
        DOM.entryRoleList.appendChild(item);
      });
    } else {
      DOM.entryRoleList.classList.add('hidden');
    }
  });

  // Close lookup containers on click outside
  document.addEventListener('click', (e) => {
    if (!DOM.entryProject.contains(e.target) && !DOM.entryProjectList.contains(e.target)) {
      DOM.entryProjectList.classList.add('hidden');
    }
    if (!DOM.entryRole.contains(e.target) && !DOM.entryRoleList.contains(e.target)) {
      DOM.entryRoleList.classList.add('hidden');
    }
  });
}

// Search Role records from Salesforce
async function searchRoleRecords(sobject, term, projectId) {
  if (state.mockMode) {
    const list = MOCK_DATA.roles[projectId] || MOCK_DATA.roles['default'];
    return list.filter(r => r.Name.toLowerCase().includes(term.toLowerCase()));
  }

  try {
    const selectFields = ['Id', 'Name'];
    const searchConditions = [`Name LIKE '%${term}%'`];
    const nameRelations = [];

    if (state.roleFields) {
      state.roleFields.forEach(f => {
        // Lookups pointing to User, Contact, or custom resource/employee/people objects
        if (f.type === 'reference' && f.relationshipName && f.referenceTo && f.referenceTo.length > 0) {
          const refObj = f.referenceTo[0].toLowerCase();
          if (refObj === 'user' || refObj === 'contact' || refObj.includes('resource') || f.name.toLowerCase().includes('resource') || f.name.toLowerCase().includes('user')) {
            nameRelations.push(f.relationshipName);
            selectFields.push(`${f.relationshipName}.Name`);
            searchConditions.push(`${f.relationshipName}.Name LIKE '%${term}%'`);
          }
        }
        // Custom text fields for Role name/Title/Resource Name
        if ((f.type === 'string' || f.type === 'textarea') && (f.name.toLowerCase().includes('role') || f.name.toLowerCase().includes('resource') || f.name.toLowerCase().includes('title') || f.name.toLowerCase().includes('name'))) {
          if (f.name !== 'Name') {
            selectFields.push(f.name);
            searchConditions.push(`${f.name} LIKE '%${term}%'`);
          }
        }
      });
    }

    let projectFieldName = 'Project__c';
    if (state.roleFields) {
      const projF = state.roleFields.find(f => f.name.toLowerCase() === 'project__c' || (f.type === 'reference' && f.referenceTo && f.referenceTo.includes(state.projectReferencedSObject)));
      if (projF) projectFieldName = projF.name;
    }

    const selectClause = [...new Set(selectFields)].join(', ');
    const searchClause = searchConditions.join(' OR ');

    // Attempt SOQL query filtered by Project lookup
    let query = `SELECT ${selectClause} FROM ${sobject} WHERE ${projectFieldName} = '${projectId}' AND (${searchClause}) LIMIT 15`;
    let url = `${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`;
    
    let res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      return processRoleRecords(data.records || [], nameRelations, state.roleFields);
    }

    // Fallback: retry without project filter
    console.warn(`Role filtering query failed. Retrying without project filter...`);
    query = `SELECT ${selectClause} FROM ${sobject} WHERE (${searchClause}) LIMIT 15`;
    url = `${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`;
    res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });
    
    if (res.ok) {
      const data = await res.json();
      return processRoleRecords(data.records || [], nameRelations, state.roleFields);
    }
    return [];
  } catch (err) {
    console.error('Role search failed:', err);
    // Standard basic fallback
    try {
      const query = `SELECT Id, Name FROM ${sobject} WHERE Name LIKE '%${term}%' LIMIT 10`;
      const url = `${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        return data.records || [];
      }
    } catch (innerErr) {
      console.error('Fallback role search failed:', innerErr);
    }
    return [];
  }
}

// Format role records into user-friendly names for autocomplete selection
function processRoleRecords(records, nameRelations, fields) {
  return records.map(rec => {
    let displayName = '';
    
    // 1. Try related names (e.g. User__r.Name or Resource__r.Name)
    for (const relName of nameRelations) {
      if (rec[relName] && rec[relName].Name) {
        displayName = rec[relName].Name;
        break;
      }
    }
    
    // 2. Try text fields (like Role__c, Title__c)
    if (!displayName && fields) {
      const textFields = fields.filter(f => (f.type === 'string' || f.type === 'textarea') && f.name !== 'Name');
      for (const tf of textFields) {
        if (rec[tf.name]) {
          displayName = rec[tf.name];
          break;
        }
      }
    }

    // 3. Fallback to Name
    if (!displayName) {
      displayName = rec.Name || '';
    } else {
      let roleText = '';
      if (fields) {
        const roleField = fields.find(f => f.name.toLowerCase().includes('role') && (f.type === 'string' || f.type === 'picklist'));
        if (roleField && rec[roleField.name] && rec[roleField.name] !== displayName) {
          roleText = rec[roleField.name];
        }
      }
      if (roleText) {
        displayName = `${displayName} - ${roleText}`;
      } else if (rec.Name && !rec.Name.startsWith('PR-') && rec.Name !== displayName) {
        displayName = `${displayName} - ${rec.Name}`;
      }
    }

    return {
      Id: rec.Id,
      Name: displayName
    };
  });
}

// Resolves a field name to its corresponding relationship field name in SOQL (e.g., Project__c -> Project__r)
function getRelationshipName(fieldName) {
  if (!fieldName) return '';
  if (fieldName.endsWith('__c')) {
    return fieldName.slice(0, -3) + '__r';
  }
  if (fieldName.endsWith('Id')) {
    return fieldName.slice(0, -2);
  }
  return fieldName;
}

// Update temp sum of bubble inputs
function updateEntrySum() {
  let sum = 0;
  DOM.bubbleInputs.forEach((input, index) => {
    const val = parseFloat(input.value) || 0;
    state.entryHours[index] = val;
    sum += val;
    if (val > 0) {
      input.classList.add('has-value');
    } else {
      input.classList.remove('has-value');
    }
  });
  DOM.entryTotalHours.innerText = sum.toFixed(2);
}

// Clear all fields in entry form
function clearEntryForm() {
  DOM.entryProject.value = '';
  state.selectedProjectId = '';
  state.selectedProjectName = '';
  
  DOM.entryRole.value = '';
  DOM.entryRole.disabled = true;
  DOM.entryRole.placeholder = 'Select Project first...';
  state.selectedRoleId = '';
  state.selectedRoleName = '';

  DOM.entryDescription.value = '';
  DOM.entryNonBillable.checked = false;

  DOM.bubbleInputs.forEach(input => {
    input.value = '';
    input.classList.remove('has-value');
  });
  state.entryHours = [0, 0, 0, 0, 0, 0, 0];
  DOM.entryTotalHours.innerText = '0.00';
}

// Load entries for selected parent Timecard
async function loadLoggedEntries() {
  DOM.loggedEntriesList.innerHTML = '<div class="empty-state">Loading logged entries...</div>';
  
  if (state.mockMode) {
    // Load from mock entries array
    const records = MOCK_DATA.entries[state.selectedTimecardId] || [];
    state.currentEntries = records;
    renderLoggedEntriesList(records);
    calculateTimecardTotal(records);
    return;
  }

  try {
    const cObj = state.fieldMappings.childObject || 'Timecard_Entry__c';
    const projectRel = getRelationshipName(state.fieldMappings.childProject);
    const roleRel = getRelationshipName(state.fieldMappings.childRole);
    
    // Dynamically build extra fields for the child role relationship if it points to a custom resource object
    const extraRoleFields = [];
    if (state.roleFields) {
      state.roleFields.forEach(f => {
        if (f.type === 'reference' && f.relationshipName && f.referenceTo && f.referenceTo.length > 0) {
          const refObj = f.referenceTo[0].toLowerCase();
          if (refObj === 'user' || refObj === 'contact' || refObj.includes('resource') || f.name.toLowerCase().includes('resource') || f.name.toLowerCase().includes('user')) {
            extraRoleFields.push(`${roleRel}.${f.relationshipName}.Name`);
          }
        }
      });
    }
    
    const nonBillableField = state.fieldMappings.childNonBillable ? `, ${state.fieldMappings.childNonBillable}` : '';
    const extraFieldsStr = extraRoleFields.length > 0 ? `, ${extraRoleFields.join(', ')}` : '';
    
    // Fetch daily entries
    const query = `SELECT Id, ${state.fieldMappings.childProject}, ${projectRel}.Name, ${state.fieldMappings.childRole}, ${roleRel}.Name, ${state.fieldMappings.childDate}, ${state.fieldMappings.childHours}, ${state.fieldMappings.childDesc}${nonBillableField}${extraFieldsStr} FROM ${cObj} WHERE ${state.fieldMappings.childParent} = '${state.selectedTimecardId}'`;
    const res = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      
      const records = (data.records || []).map(entry => {
        // Resolve Project Name
        const projRelObj = entry[projectRel];
        const projectName = projRelObj ? projRelObj.Name : 'Unknown Project';

        // Resolve Role Name
        const roleRelObj = entry[roleRel];
        let roleName = '';
        if (roleRelObj) {
          roleName = roleRelObj.Name || '';
          
          // Check if the role field references a resource junction (like Project_Resource__c) where Name is an autonumber,
          // and see if we can find the related user/resource's name in the query response
          for (const key in roleRelObj) {
            if (roleRelObj[key] && typeof roleRelObj[key] === 'object' && roleRelObj[key].Name) {
              if (!roleName || roleName.startsWith('PR-') || roleName.startsWith('PRJ-')) {
                roleName = roleRelObj[key].Name;
                break;
              }
            }
          }
        }

        return {
          Id: entry.Id,
          ProjectId: entry[state.fieldMappings.childProject] || '',
          ProjectName: projectName,
          RoleId: entry[state.fieldMappings.childRole] || '',
          RoleName: roleName,
          Date: entry[state.fieldMappings.childDate],
          Hours: parseFloat(entry[state.fieldMappings.childHours]) || 0.0,
          Description: entry[state.fieldMappings.childDesc] || '',
          NonBillable: state.fieldMappings.childNonBillable ? (entry[state.fieldMappings.childNonBillable] === true || entry[state.fieldMappings.childNonBillable] === 'true') : false
        };
      });

      state.currentEntries = records;
      renderLoggedEntriesList(records);
      calculateTimecardTotal(records);
    } else {
      DOM.loggedEntriesList.innerHTML = '<div class="empty-state"><p>Failed to load child entries.</p></div>';
    }
  } catch (err) {
    console.error('Entries loading error:', err);
    DOM.loggedEntriesList.innerHTML = '<div class="empty-state"><p>Error retrieving records.</p></div>';
  }
}

// Group daily entry rows by Project + Role + Description to display cleanly in UI
function renderLoggedEntriesList(records) {
  DOM.loggedEntriesList.innerHTML = '';
  
  if (records.length === 0) {
    DOM.loggedEntriesList.innerHTML = '<div class="empty-state">No entries logged yet for this week.</div>';
    return;
  }

  // Grouping mapping: key = project_role_desc_nonbillable
  const groups = {};
  
  records.forEach(entry => {
    const key = `${entry.ProjectId}_${entry.RoleId}_${entry.Description}_${entry.NonBillable}`;
    if (!groups[key]) {
      groups[key] = {
        projectId: entry.ProjectId,
        projectName: entry.ProjectName,
        roleId: entry.RoleId,
        roleName: entry.RoleName,
        description: entry.Description,
        nonBillable: entry.NonBillable,
        total: 0.0,
        ids: [] // Store individual record IDs for batch deletion
      };
    }
    groups[key].total += entry.Hours;
    groups[key].ids.push(entry.Id);
  });

  Object.values(groups).forEach(g => {
    const card = document.createElement('div');
    card.className = 'entry-item-card';
    
    card.innerHTML = `
      <div class="entry-item-details">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="entry-item-title">${escapeHTML(g.projectName)}</span>
          ${g.nonBillable ? `<span class="badge non-billable">Non-Billable</span>` : ''}
        </div>
        <span class="entry-item-sub">${escapeHTML(g.roleName || 'No Role Specified')}</span>
        ${g.description ? `<span class="entry-item-sub italic">"${escapeHTML(g.description)}"</span>` : ''}
      </div>
      <div class="entry-item-actions">
        <span class="entry-item-hours">${g.total.toFixed(2)}h</span>
        ${state.selectedTimecard.Status === 'Draft' ? `
          <button class="icon-btn edit-entry-btn" title="Edit Entry Group">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"></path></svg>
          </button>
          <button class="icon-btn delete-entry-btn" title="Delete Entry Group">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        ` : ''}
      </div>
    `;

    // Wire up buttons
    const editBtn = card.querySelector('.edit-entry-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => startEditingEntryGroup(g));
    }

    const delBtn = card.querySelector('.delete-entry-btn');
    if (delBtn) {
      delBtn.addEventListener('click', () => deleteEntryGroup(g.ids));
    }

    DOM.loggedEntriesList.appendChild(card);
  });
}

// Calculate total hours of loaded entries
function calculateTimecardTotal(records) {
  const sum = records.reduce((a, b) => a + b.Hours, 0.0);
  DOM.cardTotalHours.innerText = `${sum.toFixed(2)} hrs`;
}

// Start editing a logged entry group
function startEditingEntryGroup(g) {
  state.editMode = true;
  state.editingGroupIds = g.ids;

  // Set Project values
  state.selectedProjectId = g.projectId;
  state.selectedProjectName = g.projectName;
  DOM.entryProject.value = g.projectName;

  // Set Role values
  state.selectedRoleId = g.roleId;
  state.selectedRoleName = g.roleName;
  DOM.entryRole.value = g.roleName;
  DOM.entryRole.removeAttribute('disabled');

  // Fill details
  DOM.entryDescription.value = g.description || '';
  DOM.entryNonBillable.checked = g.nonBillable || false;

  // Reset hours array
  state.entryHours = [0, 0, 0, 0, 0, 0, 0];

  // Map hours from state.currentEntries for this group
  const groupEntries = state.currentEntries.filter(entry => 
    entry.ProjectId === g.projectId &&
    entry.RoleId === g.roleId &&
    entry.Description === g.description &&
    entry.NonBillable === g.nonBillable
  );

  groupEntries.forEach(entry => {
    const entryDate = parseLocalDate(entry.Date);
    // Find index of day (0 = Mon, 6 = Sun)
    // Since week starts on Monday, map accordingly
    let dayIdx = entryDate.getDay() - 1;
    if (dayIdx < 0) dayIdx = 6; // Sunday
    
    if (dayIdx >= 0 && dayIdx <= 6) {
      state.entryHours[dayIdx] = entry.Hours;
    }
  });

  // Populate UI hour inputs
  DOM.bubbleInputs.forEach(input => {
    const dayIdx = parseInt(input.dataset.day);
    const hrs = state.entryHours[dayIdx];
    input.value = hrs > 0 ? hrs : '';
    if (hrs > 0) {
      input.classList.add('has-value');
    } else {
      input.classList.remove('has-value');
    }
  });

  // Update sum indicator
  const sumHrs = state.entryHours.reduce((a, b) => a + b, 0.0);
  DOM.entryTotalHours.innerText = sumHrs.toFixed(2);

  // Update Save button UI to Edit mode
  DOM.saveEntryBtn.querySelector('span').innerText = 'Update Timecard Entry';
  DOM.cancelEditBtn.classList.remove('hidden');

  // Smooth scroll to top/entry form so user notices they are editing
  DOM.entryFormContainer.scrollIntoView({ behavior: 'smooth' });
}

// Cancel editing and reset form
function cancelEditing() {
  state.editMode = false;
  state.editingGroupIds = null;

  // Restore Save button UI
  DOM.saveEntryBtn.querySelector('span').innerText = 'Save Timecard Entry';
  DOM.cancelEditBtn.classList.add('hidden');

  // Clear form
  clearEntryForm();
}

// Save Entry records to Salesforce
async function saveTimecardEntry() {
  if (state.saving) return;

  const totalHrs = parseFloat(DOM.entryTotalHours.innerText) || 0;
  if (totalHrs === 0) {
    showToast('Please log hours (Monday-Sunday) to save.', 'warning');
    return;
  }

  if (!state.selectedProjectId) {
    showToast('Please search and select a Project first.', 'warning');
    return;
  }

  setSaveLoading(true);
  const weekStart = parseLocalDate(state.selectedTimecard.WeekOf);

  if (state.mockMode) {
    // Save to local mock lists
    setTimeout(() => {
      if (!MOCK_DATA.entries[state.selectedTimecardId]) {
        MOCK_DATA.entries[state.selectedTimecardId] = [];
      }
      
      if (state.editMode && state.editingGroupIds) {
        MOCK_DATA.entries[state.selectedTimecardId] = MOCK_DATA.entries[state.selectedTimecardId].filter(
          entry => !state.editingGroupIds.includes(entry.Id)
        );
      }
      
      state.entryHours.forEach((hrs, dayIdx) => {
        if (hrs > 0) {
          const entryDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dayIdx);
          
          MOCK_DATA.entries[state.selectedTimecardId].push({
            Id: 'e_mock_' + Math.random().toString(36).substr(2, 9),
            ProjectId: state.selectedProjectId,
            ProjectName: state.selectedProjectName,
            RoleId: state.selectedRoleId,
            RoleName: state.selectedRoleName,
            Date: formatDate(entryDate),
            Hours: hrs,
            Description: DOM.entryDescription.value.trim(),
            NonBillable: DOM.entryNonBillable.checked
          });
        }
      });

      const wasEdit = state.editMode;
      setSaveLoading(false);
      showToast(wasEdit ? 'Entry updated successfully!' : 'Entry saved successfully!', 'success');
      if (wasEdit) {
        cancelEditing();
      } else {
        clearEntryForm();
      }
      loadLoggedEntries();
    }, 1000);
    return;
  }

  // Real Salesforce SObject tree batch insert
  try {
    const cObj = state.fieldMappings.childObject || 'Timecard_Entry__c';
    
    // If in Edit Mode, delete existing records first
    if (state.editMode && state.editingGroupIds && state.editingGroupIds.length > 0) {
      updateStatus('syncing', 'Updating entries...');
      for (let id of state.editingGroupIds) {
        const delRes = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${cObj}/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
        });
        if (!delRes.ok) {
          console.warn(`Failed to delete old entry ID ${id} during update`);
        }
      }
    }

    const entryRecords = [];
    state.entryHours.forEach((hrs, dayIdx) => {
      if (hrs > 0) {
        const entryDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dayIdx);
        
        const record = {
          attributes: { type: cObj, referenceId: `ref_${dayIdx}` },
          [state.fieldMappings.childParent]: state.selectedTimecardId,
          [state.fieldMappings.childProject]: state.selectedProjectId,
          [state.fieldMappings.childDate]: formatDate(entryDate),
          [state.fieldMappings.childHours]: hrs,
          [state.fieldMappings.childDesc]: DOM.entryDescription.value.trim()
        };
        
        if (state.fieldMappings.childNonBillable) {
          record[state.fieldMappings.childNonBillable] = DOM.entryNonBillable.checked;
        }
        
        if (state.selectedRoleId) {
          record[state.fieldMappings.childRole] = state.selectedRoleId;
        }

        entryRecords.push(record);
      }
    });

    if (entryRecords.length > 0) {
      const compositeBody = { records: entryRecords };
      const resComposite = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/composite/tree/${cObj}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.sfAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(compositeBody)
      });

      if (!resComposite.ok) {
        const compositeErr = await resComposite.text();
        throw new Error(`Composite entry creation failed: ${compositeErr}`);
      }
    }

    const wasEdit = state.editMode;
    setSaveLoading(false);
    showToast(wasEdit ? 'Entry updated in Salesforce!' : 'Entry saved to Salesforce!', 'success');
    if (wasEdit) {
      cancelEditing();
    } else {
      clearEntryForm();
    }
    await loadLoggedEntries();
    updateStatus('connected', 'Connected');
  } catch (error) {
    console.error('Error saving entry:', error);
    showToast(`Failed to save entry: ${error.message}`, 'error');
    setSaveLoading(false);
    updateStatus('connected', 'Error');
  }
}

// Delete Logged Entry Group
async function deleteEntryGroup(ids) {
  if (confirm(`Are you sure you want to delete this entry? This deletes all associated daily hours from Salesforce.`)) {
    if (state.mockMode) {
      MOCK_DATA.entries[state.selectedTimecardId] = MOCK_DATA.entries[state.selectedTimecardId].filter(
        entry => !ids.includes(entry.Id)
      );
      showToast('Entry deleted successfully.', 'success');
      loadLoggedEntries();
      return;
    }

    // Real Salesforce record deletions
    try {
      updateStatus('syncing', 'Deleting entry...');
      const cObj = state.fieldMappings.childObject || 'Timecard_Entry__c';
      
      // Delete entries in serial
      for (let id of ids) {
        const res = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${cObj}/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
        });
        if (!res.ok) {
          console.warn(`Failed to delete record ID ${id}`);
        }
      }
      
      showToast('Entry deleted from Salesforce!', 'success');
      await loadLoggedEntries();
      updateStatus('connected', 'Connected');
    } catch (err) {
      console.error('Error deleting entry:', err);
      showToast('Failed to delete entries from Salesforce.', 'error');
      updateStatus('connected', 'Error');
    }
  }
}

// Submit Timecard to Salesforce
// Submit Timecard to Salesforce
async function submitTimecardRecord() {
  if (state.saving) return;

  if (state.currentEntries.length === 0) {
    showToast('Cannot submit empty timecard. Please save entries first.', 'warning');
    return;
  }

  if (confirm('Are you sure you want to submit this timecard for approval? This will lock all entry modifications.')) {
    setSubmitLoading(true);

    if (state.mockMode) {
      setTimeout(() => {
        // Find and update mock status
        const tc = MOCK_DATA.timecards.find(t => t.Id === state.selectedTimecardId);
        if (tc) {
          tc.Status = 'Submitted';
          tc.TotalHours = parseFloat(DOM.cardTotalHours.innerText);
          tc.Sentiment = DOM.sentimentSelect.value || '';
          tc.Feedback = DOM.feedbackNotes.value || '';
        }
        
        // Update badge
        state.selectedTimecard.Status = 'Submitted';
        state.selectedTimecard.Sentiment = DOM.sentimentSelect.value || '';
        state.selectedTimecard.Feedback = DOM.feedbackNotes.value || '';
        updateStatusBadge('Submitted');
        
        // Lock actions
        DOM.sentimentSubmitContainer.classList.add('disabled-panel');
        DOM.saveEntryBtn.disabled = true;
        DOM.saveTimecardBtn.disabled = true;
        DOM.submitTimecardBtn.disabled = true;
        
        setSubmitLoading(false);
        showToast('Timecard submitted successfully (Mock)!', 'success');
        onTimecardSelected(); // reload view state
      }, 1500);
      return;
    }

    // Real Salesforce submission — Status__c is controlled by approval process (read-only for direct writes).
    // Step 1: Save sentiment + feedback fields (these are writable).
    // Step 2: Call Process Approvals API to submit the record into the approval process.
    try {
      updateStatus('syncing', 'Submitting Timecard...');

      // Step 1: Pre-save writable fields (sentiment & feedback) if mapped
      const writablePayload = {};
      if (state.fieldMappings.parentSentiment && DOM.sentimentSelect.value) {
        writablePayload[state.fieldMappings.parentSentiment] = DOM.sentimentSelect.value;
      }
      if (state.fieldMappings.parentFeedback && DOM.feedbackNotes.value) {
        writablePayload[state.fieldMappings.parentFeedback] = DOM.feedbackNotes.value;
      }

      if (Object.keys(writablePayload).length > 0) {
        const pObj = state.fieldMappings.parentObject || 'Timecard__c';
        const resPatch = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${pObj}/${state.selectedTimecardId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${state.sfAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(writablePayload)
        });
        if (!resPatch.ok) {
          const bodyText = await resPatch.text();
          throw new Error(getSalesforceError(bodyText) || 'Failed to save Timecard details before submission.');
        }
      }

      // Step 2: Submit to Salesforce Approval Process (this sets Status__c via the process)
      const approvalPayload = {
        requests: [{
          actionType: 'Submit',
          contextId: state.selectedTimecardId,
          comments: 'Submitted via Minlopro Timecard Extension'
        }]
      };

      const resApproval = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/process/approvals/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.sfAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(approvalPayload)
      });

      if (!resApproval.ok) {
        const bodyText = await resApproval.text();
        throw new Error(getSalesforceError(bodyText) || 'Failed to submit Timecard to the approval process.');
      }

      const approvalResult = await resApproval.json();
      // Check if approval submission was successful
      const approvalItem = Array.isArray(approvalResult) ? approvalResult[0] : approvalResult;
      if (approvalItem && approvalItem.success === false) {
        const errMsg = (approvalItem.errors && approvalItem.errors[0] && approvalItem.errors[0].message) || 'Approval submission rejected by Salesforce.';
        throw new Error(errMsg);
      }

      setSubmitLoading(false);
      showToast('Timecard submitted for approval!', 'success');
      updateStatus('connected', 'Submitted');

      // Refresh Timecards list & selection
      await loadAvailableTimecards();
      DOM.timecardSelect.value = state.selectedTimecardId;
      await onTimecardSelected();
    } catch (error) {
      console.error('Submission error:', error);
      showToast(`Submission failed: ${error.message}`, 'error');
      setSubmitLoading(false);
      updateStatus('connected', 'Connected');
    }
  }
}

// Save parent Timecard details (Sentiment & Feedback) without submitting
async function saveTimecardParentRecord() {
  if (state.saving) return;

  setParentSaveLoading(true);

  if (state.mockMode) {
    setTimeout(() => {
      // Find and update mock status details
      const tc = MOCK_DATA.timecards.find(t => t.Id === state.selectedTimecardId);
      if (tc) {
        tc.Sentiment = DOM.sentimentSelect.value || '';
        tc.Feedback = DOM.feedbackNotes.value || '';
      }
      
      state.selectedTimecard.Sentiment = DOM.sentimentSelect.value || '';
      state.selectedTimecard.Feedback = DOM.feedbackNotes.value || '';
      
      setParentSaveLoading(false);
      showToast('Timecard details saved successfully (Mock)!', 'success');
    }, 1000);
    return;
  }

  try {
    updateStatus('syncing', 'Saving Timecard details...');
    const pObj = state.fieldMappings.parentObject || 'Timecard__c';

    const savePayload = {};
    if (state.fieldMappings.parentSentiment) {
      savePayload[state.fieldMappings.parentSentiment] = DOM.sentimentSelect.value || '';
    }
    if (state.fieldMappings.parentFeedback) {
      savePayload[state.fieldMappings.parentFeedback] = DOM.feedbackNotes.value || '';
    }

    const resSave = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${pObj}/${state.selectedTimecardId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${state.sfAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(savePayload)
    });

    if (!resSave.ok) {
      const bodyText = await resSave.text();
      throw new Error(getSalesforceError(bodyText) || 'Failed to update Timecard details in Salesforce.');
    }

    setParentSaveLoading(false);
    showToast('Timecard details saved successfully!', 'success');
    updateStatus('connected', 'Connected');
    
    // Refresh parent values in background
    await loadAvailableTimecards();
    DOM.timecardSelect.value = state.selectedTimecardId;
    await onTimecardSelected();
  } catch (error) {
    console.error('Save Timecard details error:', error);
    showToast(`Save failed: ${error.message}`, 'error');
    setParentSaveLoading(false);
    updateStatus('connected', 'Connected');
  }
}

function setSaveLoading(loading) {
  state.saving = loading;
  const btn = DOM.saveEntryBtn;
  const spinner = btn.querySelector('.btn-spinner');
  const span = btn.querySelector('span');
  if (loading) {
    btn.disabled = true;
    spinner.classList.remove('hidden');
    span.innerText = 'Saving...';
  } else {
    btn.disabled = false;
    spinner.classList.add('hidden');
    span.innerText = 'Save Timecard Entry';
  }
}

function setParentSaveLoading(loading) {
  state.saving = loading;
  const btn = DOM.saveTimecardBtn;
  const spinner = btn.querySelector('.btn-spinner');
  const span = btn.querySelector('span');
  if (loading) {
    btn.disabled = true;
    spinner.classList.remove('hidden');
    span.innerText = 'Saving...';
  } else {
    btn.disabled = false;
    spinner.classList.add('hidden');
    span.innerText = 'Save Timecard';
  }
}

function setSubmitLoading(loading) {
  state.saving = loading;
  const btn = DOM.submitTimecardBtn;
  const spinner = btn.querySelector('.btn-spinner');
  const span = btn.querySelector('span');
  if (loading) {
    btn.disabled = true;
    spinner.classList.remove('hidden');
    span.innerText = 'Submitting...';
  } else {
    btn.disabled = false;
    spinner.classList.add('hidden');
    span.innerText = 'Submit for Approval';
  }
}

// Detect session from active cookies
async function detectCookieSession(silent = false) {
  if (typeof chrome === 'undefined' || !chrome.cookies) {
    if (!silent) showToast('Cookie API not available.', 'error');
    return;
  }

  const domainPattern = DOM.sfInstanceDomain.value.trim();
  updateStatus('syncing', 'Checking active tab & cookies...');

  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let activeTabHost = '';
      if (tabs && tabs[0] && tabs[0].url) {
        try {
          const tabUrl = new URL(tabs[0].url);
          if (tabUrl.hostname.includes('.force.com') || tabUrl.hostname.includes('.salesforce.com')) {
            activeTabHost = tabUrl.hostname;
          }
        } catch (e) {
          console.error('Error parsing tab URL:', e);
        }
      }

      chrome.cookies.getAll({ name: 'sid' }, async (cookies) => {
        let matchedCookie = null;

        if (activeTabHost) {
          let targetHost = activeTabHost;
          if (activeTabHost.includes('.lightning.force.com')) {
            targetHost = activeTabHost.replace('.lightning.force.com', '.my.salesforce.com');
          }
          
          matchedCookie = cookies.find(c => {
            const cDom = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
            return targetHost.includes(cDom) || activeTabHost.includes(cDom);
          });
        }

        if (!matchedCookie) {
          if (domainPattern) {
            matchedCookie = cookies.find(c => c.domain.includes(domainPattern));
          } else {
            matchedCookie = cookies.find(c => 
              c.domain.endsWith('.salesforce.com') || 
              c.domain.includes('.my.salesforce.com') || 
              c.domain.endsWith('.lightning.force.com')
            );
          }
        }

        if (matchedCookie) {
          let instanceDomain = matchedCookie.domain;
          if (instanceDomain.startsWith('.')) {
            instanceDomain = instanceDomain.substring(1);
          }
          
          let instanceUrl = `https://${instanceDomain}`;
          if (instanceDomain.includes('.lightning.force.com')) {
            instanceUrl = `https://${instanceDomain.replace('.lightning.force.com', '.my.salesforce.com')}`;
          }
          
          const token = matchedCookie.value;
          const valid = await validateConnection(instanceUrl, token);
          if (valid) {
            chrome.storage.local.set({
              sfSettings: {
                authMethod: 'cookie',
                domainPattern: domainPattern || instanceDomain,
                instanceUrl: instanceUrl,
                accessToken: token
              }
            });
            if (!silent) showToast(`Salesforce session auto-detected from ${instanceDomain}!`, 'success');
          } else {
            if (!silent) showToast('Session found but API access rejected. Trying other sessions...', 'warning');
            
            let fallbackConnected = false;
            for (let c of cookies) {
              if (c.domain === matchedCookie.domain) continue;
              if (c.domain.endsWith('.salesforce.com') || c.domain.includes('.my.salesforce.com')) {
                let dom = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
                let url = `https://${dom}`;
                const isValid = await validateConnection(url, c.value);
                if (isValid) {
                  chrome.storage.local.set({
                    sfSettings: {
                      authMethod: 'cookie',
                      domainPattern: domainPattern || dom,
                      instanceUrl: url,
                      accessToken: c.value
                    }
                  });
                  fallbackConnected = true;
                  if (!silent) showToast(`Fallback connected to ${dom}!`, 'success');
                  break;
                }
              }
            }

            if (!fallbackConnected) {
              enableMockMode();
            }
          }
        } else {
          if (!silent) showToast('No Salesforce session cookies found. Please open Salesforce in your browser.', 'warning');
          enableMockMode();
        }
      });
    });
  } catch (err) {
    console.error('Cookie detection error:', err);
    if (!silent) showToast('Failed to read cookies.', 'error');
    enableMockMode();
  }
}

// Save Manual Credentials
async function saveManualCredentials() {
  const endpoint = DOM.sfEndpoint.value.trim();
  const token = DOM.sfAccessTokenInput.value.trim();
  if (!endpoint || !token) {
    showToast('Please fill in both Instance URL and Access Token.', 'warning');
    return;
  }
  
  updateStatus('syncing', 'Connecting manually...');
  const valid = await validateConnection(endpoint, token);
  if (valid) {
    chrome.storage.local.set({
      sfSettings: {
        authMethod: 'manual',
        instanceUrl: endpoint,
        accessToken: token,
        domainPattern: ''
      }
    });
    showToast('Connected manually to Salesforce!', 'success');
    disableMockMode();
    loadAvailableTimecards();
  } else {
    showToast('Manual connection failed. Verify URL and Access Token.', 'error');
    updateStatus('disconnected', 'Disconnected');
  }
}

// Validate Connection by fetching User profile
async function validateConnection(instanceUrl, token) {
  try {
    disableMockMode();
    const url = `${instanceUrl}/services/oauth2/userinfo`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      state.sfConnected = true;
      state.sfInstanceUrl = instanceUrl;
      state.sfAccessToken = token;
      state.sfUser = {
        Id: data.user_id,
        Name: data.name,
        Email: data.email
      };
      
      updateStatus('connected', 'Connected');
      loadAvailableTimecards();
      return true;
    }
    
    // Attempt fallback query
    const queryUrl = `${instanceUrl}/services/data/v58.0/query?q=SELECT+Id,Name,Email+FROM+User+LIMIT+1`;
    const qres = await fetch(queryUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (qres.ok) {
      state.sfConnected = true;
      state.sfInstanceUrl = instanceUrl;
      state.sfAccessToken = token;
      state.sfUser = {
        Id: 'Current_User_Id',
        Name: 'Salesforce User',
        Email: ''
      };
      updateStatus('connected', 'Connected');
      loadAvailableTimecards();
      return true;
    }
    return false;
  } catch (error) {
    console.error('Validation error:', error);
    return false;
  }
}

function disableMockMode() {
  state.mockMode = false;
}

// Save Mappings
function saveFieldMappings() {
  const mappings = {
    parentObject: DOM.mapParentObj.value.trim(),
    childObject: DOM.mapChildObj.value.trim(),
    parentResource: DOM.mapParentResource.value.trim(),
    parentWeek: DOM.mapParentWeek.value.trim(),
    parentStatus: DOM.mapParentStatus.value.trim(),
    parentSentiment: DOM.mapParentSentiment.value.trim(),
    parentFeedback: DOM.mapParentFeedback ? DOM.mapParentFeedback.value.trim() : 'Workload_Feedback__c',
    childParent: DOM.mapChildParent.value.trim(),
    childProject: DOM.mapChildProject.value.trim(),
    childRole: DOM.mapChildRole.value.trim(),
    childDate: DOM.mapChildDate.value.trim(),
    childHours: DOM.mapChildHours.value.trim(),
    childDesc: DOM.mapChildDesc.value.trim(),
    childNonBillable: DOM.mapChildNonBillable.value.trim()
  };

  chrome.storage.local.set({ fieldMappings: mappings }, () => {
    state.fieldMappings = mappings;
    showToast('Field mappings saved successfully!', 'success');
  });
}

// Auto-match mappings from Salesforce Describe
async function autoDetectMappings() {
  if (!state.sfConnected || state.mockMode) {
    showToast('Must be connected to active Salesforce connection to auto-detect.', 'warning');
    return;
  }

  showToast('Describing SObjects in Salesforce...', 'info');
  updateStatus('syncing', 'Describing SObjects...');

  try {
    const parentObj = DOM.mapParentObj.value.trim();
    const childObj = DOM.mapChildObj.value.trim();
    
    const parentRes = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${parentObj}/describe`, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });
    const childRes = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${childObj}/describe`, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });

    if (!parentRes.ok || !childRes.ok) {
      showToast('Could not describe objects. Make sure object API names are correct.', 'error');
      updateStatus('connected', 'Connected');
      return;
    }

    const parentMeta = await parentRes.json();
    const childMeta = await childRes.json();

    const pFields = parentMeta.fields;
    const detectedParent = {};
    
    const forField = pFields.find(f => f.name.toLowerCase().includes('resource') || f.name.toLowerCase().includes('for') || f.name.toLowerCase().includes('employee') || f.name.toLowerCase() === 'ownerid');
    detectedParent.parentResource = forField ? forField.name : 'Timecard_For__c';

    const weekField = pFields.find(f => f.name.toLowerCase().includes('week') || f.name.toLowerCase().includes('start') || f.type === 'date');
    detectedParent.parentWeek = weekField ? weekField.name : 'Week_of__c';

    const statusField = pFields.find(f => f.name.toLowerCase() === 'status__c' || f.name.toLowerCase().includes('status'));
    detectedParent.parentStatus = statusField ? statusField.name : 'Status__c';

    const sentimentField = pFields.find(f => f.name.toLowerCase().includes('sentiment'));
    detectedParent.parentSentiment = sentimentField ? sentimentField.name : 'Weekly_Sentiment__c';

    const cFields = childMeta.fields;
    const detectedChild = {};

    const timecardLookup = cFields.find(f => f.name.toLowerCase() === 'timecard__c' || f.name.toLowerCase().includes('timecard'));
    detectedChild.childParent = timecardLookup ? timecardLookup.name : 'Timecard__c';

    const projectLookup = cFields.find(f => f.name.toLowerCase().includes('project') && f.type === 'reference');
    detectedChild.childProject = projectLookup ? projectLookup.name : 'Project__c';

    const roleLookup = cFields.find(f => (f.name.toLowerCase().includes('role') || f.name.toLowerCase().includes('resource')) && f.type === 'reference');
    detectedChild.childRole = roleLookup ? roleLookup.name : 'Project_Role__c';

    const dateField = cFields.find(f => f.name.toLowerCase().includes('date') || f.type === 'date');
    detectedChild.childDate = dateField ? dateField.name : 'Date__c';

    const hoursField = cFields.find(f => f.name.toLowerCase().includes('hour') || f.type === 'double');
    detectedChild.childHours = hoursField ? hoursField.name : 'Hours__c';

    const descField = cFields.find(f => f.name.toLowerCase().includes('desc') || f.name.toLowerCase().includes('task') || f.name.toLowerCase().includes('note'));
    detectedChild.childDesc = descField ? descField.name : 'Task_Description__c';

    const feedbackField = pFields.find(f => f.name.toLowerCase().includes('feedback') || f.name.toLowerCase().includes('workload'));
    detectedParent.parentFeedback = feedbackField ? feedbackField.name : 'Workload_Feedback__c';

    DOM.mapParentResource.value = detectedParent.parentResource;
    DOM.mapParentWeek.value = detectedParent.parentWeek;
    DOM.mapParentStatus.value = detectedParent.parentStatus;
    DOM.mapParentSentiment.value = detectedParent.parentSentiment;
    if (DOM.mapParentFeedback) DOM.mapParentFeedback.value = detectedParent.parentFeedback;
    
    DOM.mapChildParent.value = detectedChild.childParent;
    DOM.mapChildProject.value = detectedChild.childProject;
    DOM.mapChildRole.value = detectedChild.childRole;
    DOM.mapChildDate.value = detectedChild.childDate;
    DOM.mapChildHours.value = detectedChild.childHours;
    DOM.mapChildDesc.value = detectedChild.childDesc;

    showToast('Fields matched and auto-detected successfully from metadata!', 'success');
    updateStatus('connected', 'Connected');
  } catch (error) {
    console.error('Auto detect error:', error);
    showToast('Failed SObject describe lookup.', 'error');
    updateStatus('connected', 'Connected');
  }
}

// Resolve Target SObjects for Lookups
async function resolveLookupSObjects() {
  if (!state.sfConnected || state.mockMode) {
    state.projectReferencedSObject = 'Project__c';
    state.roleReferencedSObject = 'Project_Role__c';
    state.roleFields = null;
    return;
  }

  try {
    const cObj = state.fieldMappings.childObject || 'Timecard_Entry__c';
    const res = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${cObj}/describe`, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });

    if (res.ok) {
      const meta = await res.json();
      
      // Auto-correct mappings if they don't match the actual fields of the object in this org
      validateAndAlignMappings(meta.fields);

      const projectField = meta.fields.find(f => f.name === state.fieldMappings.childProject);
      if (projectField && projectField.type === 'reference' && projectField.referenceTo && projectField.referenceTo.length > 0) {
        state.projectReferencedSObject = projectField.referenceTo[0];
      } else {
        state.projectReferencedSObject = 'Project__c';
      }

      const roleField = meta.fields.find(f => f.name === state.fieldMappings.childRole);
      if (roleField && roleField.type === 'reference' && roleField.referenceTo && roleField.referenceTo.length > 0) {
        state.roleReferencedSObject = roleField.referenceTo[0];
      } else {
        state.roleReferencedSObject = 'Project_Role__c';
      }

      // Fetch describe for role target object to know its fields (e.g. Project_Resource__c)
      if (state.roleReferencedSObject && state.roleReferencedSObject !== 'User' && state.roleReferencedSObject !== 'Contact') {
        try {
          const roleDescRes = await fetch(`${state.sfInstanceUrl}/services/data/v58.0/sobjects/${state.roleReferencedSObject}/describe`, {
            headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
          });
          if (roleDescRes.ok) {
            const roleMeta = await roleDescRes.json();
            state.roleFields = roleMeta.fields || [];
          }
        } catch (e) {
          console.warn(`Failed to describe role SObject ${state.roleReferencedSObject}:`, e);
          state.roleFields = null;
        }
      } else {
        state.roleFields = null;
      }
    } else {
      state.projectReferencedSObject = 'Project__c';
      state.roleReferencedSObject = 'Project_Role__c';
      state.roleFields = null;
    }
  } catch (err) {
    console.error('Error resolving lookup SObjects:', err);
    state.projectReferencedSObject = 'Project__c';
    state.roleReferencedSObject = 'Project_Role__c';
    state.roleFields = null;
  }
}

// Automatically validate field mappings against object describe results and align if necessary
function validateAndAlignMappings(cFields) {
  if (!cFields || cFields.length === 0) return;
  
  let mappingsUpdated = false;
  
  const checkField = (mappingKey, defaultVal, searchPatterns) => {
    const currentVal = state.fieldMappings[mappingKey] || defaultVal;
    const exists = cFields.some(f => f.name === currentVal);
    if (!exists) {
      // Find a matching field in cFields based on patterns
      const found = cFields.find(f => {
        const lowerName = f.name.toLowerCase();
        return searchPatterns.some(pat => lowerName.includes(pat));
      });
      if (found) {
        console.log(`Auto-corrected mapping for ${mappingKey}: '${currentVal}' -> '${found.name}'`);
        state.fieldMappings[mappingKey] = found.name;
        mappingsUpdated = true;
        updateUIFieldMapping(mappingKey, found.name);
      }
    }
  };

  checkField('childParent', 'Timecard__c', ['timecard']);
  checkField('childProject', 'Project__c', ['project']);
  checkField('childRole', 'Project_Role__c', ['role', 'resource']);
  checkField('childDate', 'Date__c', ['date']);
  checkField('childHours', 'Hours__c', ['hour', 'duration', 'qty', 'quantity']);
  checkField('childDesc', 'Task_Description__c', ['desc', 'task', 'note', 'comment', 'detail', 'work', 'summary']);
  checkField('childNonBillable', 'Non_Billable__c', ['billable', 'non']);

  if (mappingsUpdated) {
    chrome.storage.local.set({ fieldMappings: state.fieldMappings }, () => {
      console.log('Auto-corrected field mappings saved to local storage.');
    });
  }
}

// Automatically validate parent mapping fields against object describe results and align if necessary
// Dynamically populate the sentiment dropdown from Salesforce picklist describe metadata
function populateSentimentPicklist(pFields) {
  const sentimentFieldName = state.fieldMappings.parentSentiment || 'Weekly_Sentiment__c';
  if (!sentimentFieldName) return;

  const field = pFields.find(f => f.name === sentimentFieldName);
  if (!field || !field.picklistValues || field.picklistValues.length === 0) return;

  const select = DOM.sentimentSelect;
  if (!select) return;

  // Preserve currently selected value
  const currentVal = select.value;

  // Rebuild options from live Salesforce picklist values
  select.innerHTML = '<option value="">-- Select Sentiment --</option>';
  field.picklistValues
    .filter(pv => pv.active)
    .forEach(pv => {
      const opt = document.createElement('option');
      opt.value = pv.value;      // Actual API value Salesforce expects
      opt.textContent = pv.label; // Human-readable label
      select.appendChild(opt);
    });

  // Restore previously selected value if still valid
  if (currentVal) select.value = currentVal;

  console.log(`Populated sentiment picklist with ${field.picklistValues.filter(pv => pv.active).length} values from Salesforce.`);
}

function validateAndAlignParentMappings(pFields) {
  if (!pFields || pFields.length === 0) return;
  
  let mappingsUpdated = false;
  
  const checkParentField = (mappingKey, defaultVal, searchPatterns, optional = false) => {
    const currentVal = state.fieldMappings[mappingKey] || defaultVal;
    if (!currentVal && optional) return; // Already cleared/disabled

    const exists = pFields.some(f => f.name === currentVal);
    if (!exists) {
      // Find a matching field in pFields based on patterns
      const found = pFields.find(f => {
        const lowerName = f.name.toLowerCase();
        return searchPatterns.some(pat => lowerName.includes(pat));
      });
      if (found) {
        console.log(`Auto-corrected parent mapping for ${mappingKey}: '${currentVal}' -> '${found.name}'`);
        state.fieldMappings[mappingKey] = found.name;
        mappingsUpdated = true;
        updateUIFieldMapping(mappingKey, found.name);
      } else if (optional) {
        console.log(`Optional parent field ${mappingKey} ('${currentVal}') not found in org. Disabling mapping.`);
        state.fieldMappings[mappingKey] = '';
        mappingsUpdated = true;
        updateUIFieldMapping(mappingKey, '');
      }
    }
  };

  checkParentField('parentResource', 'Timecard_For__c', ['resource', 'for', 'employee', 'user', 'contact']);
  checkParentField('parentWeek', 'Week_of__c', ['week', 'start', 'date']);
  checkParentField('parentStatus', 'Status__c', ['status', 'state']);
  checkParentField('parentSentiment', 'Weekly_Sentiment__c', ['sentiment', 'workload'], true);
  checkParentField('parentFeedback', 'Workload_Feedback__c', ['feedback', 'note', 'comment'], true);

  if (mappingsUpdated) {
    chrome.storage.local.set({ fieldMappings: state.fieldMappings }, () => {
      console.log('Auto-corrected parent field mappings saved to local storage.');
    });
  }
}

// Helper to update settings UI values when auto-aligned
function updateUIFieldMapping(key, val) {
  const elementIdMap = {
    parentObject: 'map-parent-object',
    childObject: 'map-child-object',
    parentResource: 'map-parent-resource',
    parentWeek: 'map-parent-week',
    parentStatus: 'map-parent-status',
    parentSentiment: 'map-parent-sentiment',
    parentFeedback: 'map-parent-feedback',
    childParent: 'map-child-parent',
    childProject: 'map-child-project',
    childRole: 'map-child-role',
    childDate: 'map-child-date',
    childHours: 'map-child-hours',
    childDesc: 'map-child-desc',
    childNonBillable: 'map-child-non-billable'
  };
  
  const id = elementIdMap[key];
  if (id) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
}

// Parse Salesforce REST API errors to extract the actual message
function getSalesforceError(text) {
  try {
    const errs = JSON.parse(text);
    if (Array.isArray(errs) && errs.length > 0) {
      return errs[0].message || text;
    }
    if (errs && errs.message) {
      return errs.message;
    }
    return text;
  } catch (e) {
    return text;
  }
}

// Format Date YYYY-MM-DD
function formatDate(date) {
  const d = new Date(date);
  let month = '' + (d.getMonth() + 1);
  let day = '' + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;

  return [year, month, day].join('-');
}

// Find Monday of Date
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

// Search Salesforce SObject Records (General)
async function searchSFRecords(sobject, term) {
  if (state.mockMode) {
    if (sobject === 'Project__c' || sobject === state.projectReferencedSObject) {
      return MOCK_DATA.projects.filter(p => p.Name.toLowerCase().includes(term.toLowerCase()));
    }
    return [];
  }

  try {
    const query = `SELECT Id, Name FROM ${sobject} WHERE Name LIKE '%${term}%' LIMIT 8`;
    const url = `${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`;
    
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      return data.records || [];
    }
    return [];
  } catch (error) {
    console.error('SOQL Search failed:', error);
    return [];
  }
}

// Load Timecard History Tab
async function loadHistory() {
  if (!state.sfUser) return;
  DOM.historyList.innerHTML = '<div class="empty-state"><p>Loading history...</p></div>';

  if (state.mockMode) {
    renderHistoryItems(MOCK_DATA.timecards);
    return;
  }

  try {
    const pObj = state.fieldMappings.parentObject || 'Timecard__c';
    const query = `SELECT Id, Name, ${state.fieldMappings.parentWeek}, ${state.fieldMappings.parentStatus}, Hours_Worked__c FROM ${pObj} WHERE ${state.fieldMappings.parentResource} = '${state.sfUser.Id}' ORDER BY ${state.fieldMappings.parentWeek} DESC LIMIT 8`;
    const url = `${state.sfInstanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${state.sfAccessToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.records && data.records.length > 0) {
        const records = data.records.map(r => ({
          Id: r.Id,
          WeekOf: r[state.fieldMappings.parentWeek],
          TotalHours: r.Hours_Worked__c || 0,
          Status: r[state.fieldMappings.parentStatus] || 'Draft',
          Sentiment: ''
        }));
        renderHistoryItems(records);
      } else {
        DOM.historyList.innerHTML = '<div class="empty-state"><p>No Salesforce timecards found.</p></div>';
      }
    } else {
      DOM.historyList.innerHTML = '<div class="empty-state"><p>Failed to load Salesforce history.</p></div>';
    }
  } catch (err) {
    console.error('History fetch error:', err);
    DOM.historyList.innerHTML = '<div class="empty-state"><p>Error connecting to Salesforce.</p></div>';
  }
}

function renderHistoryItems(records) {
  DOM.historyList.innerHTML = '';
  records.forEach(item => {
    const week = parseLocalDate(item.WeekOf);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    const dateStr = week.toLocaleDateString('en-US', options);
    const statusClass = (item.Status || '').toLowerCase();
    
    const cardHtml = `
      <div class="history-card">
        <div class="history-details">
          <h4>Week of ${dateStr}</h4>
          <p>Status: ${escapeHTML(item.Status)}</p>
        </div>
        <div class="history-meta">
          <div class="history-hours">${parseFloat(item.TotalHours).toFixed(2)} hrs</div>
          <span class="badge ${statusClass}">${escapeHTML(item.Status)}</span>
        </div>
      </div>
    `;
    DOM.historyList.insertAdjacentHTML('beforeend', cardHtml);
  });
}

function updateStatus(cls, text) {
  const dot = DOM.connectionStatus.querySelector('.status-dot');
  const txt = DOM.connectionStatus.querySelector('.status-text');
  dot.className = `status-dot ${cls}`;
  txt.innerText = text;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '';
  if (type === 'success') {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (type === 'error') {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else {
    icon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  toast.innerHTML = `${icon} <span>${escapeHTML(message)}</span>`;
  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// Initialize theme from storage
function initTheme() {
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || 'dark';
    if (theme === 'light') {
      document.body.classList.add('light-theme');
      updateThemeToggleIcon('light');
    } else {
      document.body.classList.remove('light-theme');
      updateThemeToggleIcon('dark');
    }
  });

  if (DOM.themeToggleBtn) {
    DOM.themeToggleBtn.addEventListener('click', toggleTheme);
  }
}

// Toggle light/dark modes
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  const newTheme = isLight ? 'light' : 'dark';
  chrome.storage.local.set({ theme: newTheme });
  updateThemeToggleIcon(newTheme);
}

// Update header toggle icon
function updateThemeToggleIcon(theme) {
  if (!DOM.themeToggleBtn) return;
  if (theme === 'light') {
    // Show Moon icon (switch to dark)
    DOM.themeToggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
  } else {
    // Show Sun icon (switch to light)
    DOM.themeToggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-sun"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
  }
}

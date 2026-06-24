// background.js - Minlopro Timecard Extension Service Worker

// Keep track of active connections
chrome.runtime.onInstalled.addListener(() => {
  console.log('Minlopro Timecard Extension installed successfully.');
  // Set default settings if not exists
  chrome.storage.local.get(['sfSettings', 'fieldMappings'], (result) => {
    if (!result.sfSettings) {
      chrome.storage.local.set({
        sfSettings: {
          authMethod: 'cookie', // 'cookie' or 'manual'
          instanceUrl: '',
          accessToken: '',
          domainPattern: ''
        }
      });
    }
    if (!result.fieldMappings) {
      chrome.storage.local.set({
        fieldMappings: {
          parentObject: 'Timecard__c',
          childObject: 'Timecard_Entry__c',
          parentResource: 'Timecard_For__c',
          parentWeek: 'Week_of__c',
          parentStatus: 'Status__c',
          parentSentiment: 'Workload_Weekly_Sentiment__c',
          parentFeedback: 'Workload_Feedback__c',
          childParent: 'Timecard__c',
          childProject: 'Project__c',
          childRole: 'Project_Role__c',
          childDate: 'Date__c',
          childHours: 'Hours__c',
          childDesc: 'Task_Description__c'
        }
      });
    }
  });
});

// Listen to cookie changes on Salesforce domains to alert the popup
chrome.cookies.onChanged.addListener((changeInfo) => {
  const { cookie, removed } = changeInfo;
  if (cookie.name === 'sid' && (cookie.domain.includes('salesforce.com') || cookie.domain.includes('force.com'))) {
    console.log('Salesforce Session Cookie updated:', cookie.domain, removed ? 'Removed' : 'Added');
    // Broadcast message to popups if any are open
    chrome.runtime.sendMessage({
      type: 'SF_SESSION_CHANGED',
      domain: cookie.domain,
      removed: removed
    }).catch(err => {
      // Ignore error when popup is closed
    });
  }
});

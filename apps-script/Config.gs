/**
 * Config.gs - Configuration helpers for accessing game settings stored in the Google Sheet.
 */

var CONFIG_SHEET_NAME = 'Config';
var _configCache = null;

/**
 * Retrieves a configuration value by key.
 * @param {string} key Configuration key (e.g. 'WHATSAPP_SERVER_URL')
 * @returns {any} The configuration value
 */
function getConfig(key) {
  if (!_configCache) {
    _configCache = {};
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet.getSheetByName(CONFIG_SHEET_NAME);
    if (!sheet) {
      // If the Config sheet doesn't exist, create it with headers
      sheet = spreadsheet.insertSheet(CONFIG_SHEET_NAME);
      sheet.appendRow(['Key', 'Value']);
      sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
      sheet.setColumnWidth(1, 250);
      sheet.setColumnWidth(2, 450);
    }
    
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var k = data[i][0];
      var v = data[i][1];
      if (k) {
        _configCache[k] = v;
      }
    }
  }
  return _configCache[key];
}

/**
 * Saves or updates a configuration key-value pair in the Sheet.
 * @param {string} key Configuration key
 * @param {any} value Configuration value
 */
function setConfig(key, value) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG_SHEET_NAME);
    sheet.appendRow(['Key', 'Value']);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  
  var data = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([key, value]);
  }
  
  // Update local cache if initialized
  if (_configCache) {
    _configCache[key] = value;
  }
}

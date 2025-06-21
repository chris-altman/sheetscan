// url-helpers.js
// Utilities for parsing and validating Google Sheets URLs

export class UrlHelpers {
  /**
   * Validates if a string is a valid URL
   * @param {string} string - URL string to validate
   * @returns {boolean} True if valid URL
   */
  static isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Checks if URL is a Google Sheets URL
   * @param {string} url - URL to check
   * @returns {boolean} True if Google Sheets URL
   */
  static isGoogleSheetsUrl(url) {
    return url.includes('docs.google.com/spreadsheets/') && url.includes('/d/');
  }

  /**
   * Parses Google Sheets URL to extract sheet ID and GID
   * @param {string} sheetUrl - Google Sheets URL
   * @returns {Object} Object with sheetId and gid
   * @throws {Error} If URL is invalid or not a Google Sheets URL
   */
  static parseSheetUrl(sheetUrl) {
    if (!this.isValidUrl(sheetUrl)) {
      throw new Error(`Invalid URL format: "${sheetUrl}"`);
    }
    
    if (!this.isGoogleSheetsUrl(sheetUrl)) {
      throw new Error(`Not a Google Sheets URL: "${sheetUrl}"`);
    }
    
    const sheetIdMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
      throw new Error(`Could not extract Sheet ID from URL: "${sheetUrl}"`);
    }
    
    const sheetId = sheetIdMatch[1];
    const gidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    
    return { sheetId, gid };
  }

  /**
   * Extracts just the sheet ID from a Google Sheets URL
   * @param {string} sheetUrl - Google Sheets URL
   * @returns {string} Sheet ID
   */
  static extractSheetId(sheetUrl) {
    const { sheetId } = this.parseSheetUrl(sheetUrl);
    return sheetId;
  }

  /**
   * Validates multiple URLs and returns any that are invalid
   * @param {string[]} urls - Array of URLs to validate
   * @returns {string[]} Array of invalid URLs (empty if all valid)
   */
  static validateUrls(urls) {
    const invalidUrls = [];
    
    for (const url of urls) {
      if (!this.isValidUrl(url)) {
        invalidUrls.push(url);
      }
    }
    
    return invalidUrls;
  }

  /**
   * Validates multiple Google Sheets URLs
   * @param {string[]} urls - Array of Google Sheets URLs to validate
   * @returns {Object} Object with valid and invalid URLs
   */
  static validateGoogleSheetsUrls(urls) {
    const result = { valid: [], invalid: [] };
    
    for (const url of urls) {
      try {
        this.parseSheetUrl(url);
        result.valid.push(url);
      } catch (error) {
        result.invalid.push({ url, error: error.message });
      }
    }
    
    return result;
  }
}
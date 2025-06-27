// sheets-service.js
// Handles all Google Sheets operations: reading source data, verifier URLs, and writing results

import { AuthService } from './auth-service.js';
import { UrlHelpers } from '../utils/url-helpers.js';

export class SheetsService {
  constructor(authService) {
    this.authService = authService;
    this.baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  }

  /**
   * Creates SheetsService from environment variables
   * @param {Object} env - Cloudflare Worker environment variables
   * @returns {SheetsService}
   */
  static fromEnv(env) {
    const authService = AuthService.fromEnv(env);
    return new SheetsService(authService);
  }

  /**
   * Fetches source sheet data (offers/brands)
   * @param {string} sourceSheetUrl - Google Sheets URL for source data
   * @param {string} [sheetName='Offers + Codes - US'] - Name of the sheet tab
   * @param {string} [range='A3:E'] - Range to fetch (default skips headers)
   * @returns {Promise<Array>} Array of offer objects
   */
  async fetchSourceData(sourceSheetUrl, sheetName = 'Offers %2B Codes - US', range = 'A3:E') {
    const { sheetId } = UrlHelpers.parseSheetUrl(sourceSheetUrl);
    const accessToken = await this.authService.getAccessToken();
    const fullRange = `'${sheetName}'!${range}`;

    const url = `${this.baseUrl}/${sheetId}/values/${fullRange}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch source sheet data: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const rows = data.values || [];

    // Process rows into structured offer objects
    return rows.map((row, index) => ({
      rowIndex: index + 3, // Actual row number in sheet (accounting for header skip)
      brand: row[0] || "",
      offer: row[1] || "",
      states: row[2] || "",
      keyTandC: row[3] || "",
      additionalData: row[4] || ""
    })).filter(offer => {
      // Filter out empty rows
      const hasContent = offer.brand.trim() || 
                        offer.offer.trim() || 
                        offer.states.trim() || 
                        offer.keyTandC.trim();
      return hasContent;
    });
  }

  /**
   * Fetches URLs from verifier sheet (Column A)
   * @param {string} verifierSheetUrl - Google Sheets URL for verifier data
   * @param {string} [sheetName='Sheet1'] - Name of the sheet tab
   * @param {string} [range='A2:CE412'] - Range to fetch (default is all of column A)
   * @returns {Promise<Array>} Array of URL objects with row indices
   */
  async fetchVerifierUrls(verifierSheetUrl, sheetName = 'Sheet1', range = 'A2:CE412') {
    const { sheetId } = UrlHelpers.parseSheetUrl(verifierSheetUrl);
    const accessToken = await this.authService.getAccessToken();
    const fullRange = `'${sheetName}'!${range}`;

    const url = `${this.baseUrl}/${sheetId}/values/${fullRange}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch verifier URLs: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const rows = data.values || [];

    // Process rows into URL objects with validation
    return rows.map((row, index) => ({
      rowIndex: index + 1, // Actual row number in sheet
      url: row[0] || "",
      isValid: row[0] ? UrlHelpers.isValidUrl(row[0].trim()) : false
    })).filter(urlData => {
      // Filter out empty rows and keep track of invalid URLs for debugging
      return urlData.url.trim() !== "";
    });
  }

  /**
   * Writes verification results back to verifier sheet
   * @param {string} verifierSheetUrl - Google Sheets URL for verifier data
   * @param {Array} results - Array of verification results
   * @param {string} [sheetName='Sheet1'] - Name of the sheet tab
   * @returns {Promise<void>}
   */
  async writeVerificationResults(verifierSheetUrl, results, sheetName = 'Sheet1') {
    const { sheetId } = UrlHelpers.parseSheetUrl(verifierSheetUrl);
    const accessToken = await this.authService.getAccessToken();

    // Prepare batch update requests
    const requests = [];

    for (const result of results) {
      if (!result.rowIndex) continue;

      // Determine which columns to update (B, C, D, etc.)
      const values = [
        [
          result.status || "",           // Column B: Status
          result.verification || "",     // Column C: Verification
          result.h1 || "",              // Column D: H1
          result.metaTitle || "",       // Column E: Meta Title
          result.metaDescription || "", // Column F: Meta Description
          result.timestamp || new Date().toISOString(), // Column G: Timestamp
          result.notes || ""            // Column H: Notes
        ]
      ];

      requests.push({
        range: `'${sheetName}'!B${result.rowIndex}:H${result.rowIndex}`,
        values: values
      });
    }

    // Batch update all results at once
    const batchUpdateUrl = `${this.baseUrl}/${sheetId}/values:batchUpdate`;

    const response = await fetch(batchUpdateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: requests
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to write verification results: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Gets sheet metadata (useful for debugging)
   * @param {string} sheetUrl - Google Sheets URL
   * @returns {Promise<Object>} Sheet metadata
   */
  async getSheetMetadata(sheetUrl) {
    const { sheetId } = UrlHelpers.parseSheetUrl(sheetUrl);
    const accessToken = await this.authService.getAccessToken();

    const url = `${this.baseUrl}/${sheetId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch sheet metadata: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Validates that both sheets are accessible
   * @param {string} sourceSheetUrl - Source sheet URL
   * @param {string} verifierSheetUrl - Verifier sheet URL
   * @returns {Promise<Object>} Validation results
   */
  async validateSheetAccess(sourceSheetUrl, verifierSheetUrl) {
    const results = {
      sourceSheet: { accessible: false, error: null },
      verifierSheet: { accessible: false, error: null }
    };

    try {
      await this.getSheetMetadata(sourceSheetUrl);
      results.sourceSheet.accessible = true;
    } catch (error) {
      results.sourceSheet.error = error.message;
    }

    try {
      await this.getSheetMetadata(verifierSheetUrl);
      results.verifierSheet.accessible = true;
    } catch (error) {
      results.verifierSheet.error = error.message;
    }

    return results;
  }
}
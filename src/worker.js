// worker.js
// Main Cloudflare Worker entry point - handles HTTP routing and orchestrates verification

import { SheetsService } from './services/sheets-service.js';
import { HtmlTemplates } from './templates/html-templates.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route handling
      switch (true) {
        case request.method === 'GET' && url.pathname === '/':
          return handleMainPage();
          
        case request.method === 'POST' && url.pathname === '/verify':
          return await handleVerification(request, env);
          
        case request.method === 'GET' && url.pathname === '/health':
          return handleHealthCheck();
          
        default:
          return handleNotFound();
      }
    } catch (error) {
      return handleError(error);
    }
  }
};

/**
 * Serves the main verification form
 * @returns {Response} HTML form response
 */
function handleMainPage() {
  const html = HtmlTemplates.getMainForm();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/**
 * Handles the verification process
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment variables
 * @returns {Response} Verification results or error
 */
async function handleVerification(request, env) {
  try {
    // Parse form data
    const formData = await request.formData();
    const sourceSheetUrl = formData.get('sourceSheetUrl');
    const verifierSheetUrl = formData.get('verifierSheetUrl');

    // Validate required fields
    if (!sourceSheetUrl || !verifierSheetUrl) {
      throw new Error('Both source sheet URL and verifier sheet URL are required');
    }

    // Initialize services
    const sheetsService = SheetsService.fromEnv(env);

    // Validate sheet access first
    console.log('Validating sheet access...');
    const accessValidation = await sheetsService.validateSheetAccess(sourceSheetUrl, verifierSheetUrl);
    
    if (!accessValidation.sourceSheet.accessible) {
      throw new Error(`Cannot access source sheet: ${accessValidation.sourceSheet.error}`);
    }
    
    if (!accessValidation.verifierSheet.accessible) {
      throw new Error(`Cannot access verifier sheet: ${accessValidation.verifierSheet.error}`);
    }

    // Fetch source data (offers/brands)
    console.log('Fetching source sheet data...');
    const sourceData = await sheetsService.fetchSourceData(sourceSheetUrl);
    console.log(`Found ${sourceData.length} offers in source sheet`);

    // Fetch verifier URLs
    console.log('Fetching verifier URLs...');
    const verifierUrls = await sheetsService.fetchVerifierUrls(verifierSheetUrl);
    console.log(`Found ${verifierUrls.length} URLs to verify`);

    // Filter out invalid URLs
    const validUrls = verifierUrls.filter(urlData => urlData.isValid);
    const invalidUrls = verifierUrls.filter(urlData => !urlData.isValid);
    
    if (invalidUrls.length > 0) {
      console.warn(`Found ${invalidUrls.length} invalid URLs that will be skipped`);
    }

    // Process each URL (this is where we'll add HTML parsing and LLM verification)
    const verificationResults = await processUrlsForVerification(validUrls, sourceData, env);

    // Write results back to verifier sheet
    console.log('Writing results back to verifier sheet...');
    await sheetsService.writeVerificationResults(verifierSheetUrl, verificationResults);

    // Return results page
    const html = HtmlTemplates.getResultsPage(
      verificationResults,
      verificationResults.length,
      verifierUrls.length
    );

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error) {
    console.error('Verification error:', error);
    const html = HtmlTemplates.getErrorPage(error.message, error.stack);
    return new Response(html, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

/**
 * Processes URLs for verification (placeholder for HTML parsing + LLM verification)
 * @param {Array} validUrls - Array of valid URL objects
 * @param {Array} sourceData - Source sheet data to compare against
 * @param {Object} env - Environment variables
 * @returns {Promise<Array>} Array of verification results
 */
async function processUrlsForVerification(validUrls, sourceData, env) {
  const results = [];

  // For now, we'll create placeholder results
  // TODO: Add HTML parsing and LLM verification in next phase
  for (const urlData of validUrls) {
    try {
      // Placeholder verification logic
      const result = {
        rowIndex: urlData.rowIndex,
        url: urlData.url,
        status: 'processing', // Will be 'verified', 'failed', or 'processing'
        verification: 'Placeholder - HTML parsing and LLM verification not yet implemented',
        h1: 'TODO: Extract H1',
        metaTitle: 'TODO: Extract meta title',
        metaDescription: 'TODO: Extract meta description',
        timestamp: new Date().toISOString(),
        notes: 'Initial implementation - verification logic pending'
      };

      results.push(result);
      
      // Add small delay to avoid overwhelming external sites
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`Error processing URL ${urlData.url}:`, error);
      
      results.push({
        rowIndex: urlData.rowIndex,
        url: urlData.url,
        status: 'failed',
        verification: 'Error',
        timestamp: new Date().toISOString(),
        notes: `Error: ${error.message}`
      });
    }
  }

  return results;
}

/**
 * Health check endpoint
 * @returns {Response} Health status
 */
function handleHealthCheck() {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Handles 404 errors
 * @returns {Response} 404 response
 */
function handleNotFound() {
  const html = HtmlTemplates.getErrorPage(
    'Page not found',
    'The requested page does not exist.'
  );
  
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/**
 * Handles general errors
 * @param {Error} error - The error object
 * @returns {Response} Error response
 */
function handleError(error) {
  console.error('Worker error:', error);
  
  const html = HtmlTemplates.getErrorPage(
    'Internal server error',
    error.message
  );
  
  return new Response(html, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
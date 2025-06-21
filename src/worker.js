// worker.js
// Main Cloudflare Worker entry point - handles HTTP routing and orchestrates verification

import { SheetsService } from './services/sheets-service.js';
import { HtmlParserService } from './services/html-parser.js';
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
    const htmlParser = new HtmlParserService({
      timeout: 15000, // 15 second timeout per URL
      maxRetries: 2
    });

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

    // Process each URL with HTML parsing
    console.log(`Starting HTML parsing for ${validUrls.length} URLs...`);
    const verificationResults = await processUrlsForVerification(validUrls, sourceData, htmlParser);

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
 * Processes URLs for verification with actual HTML parsing
 * @param {Array} validUrls - Array of valid URL objects
 * @param {Array} sourceData - Source sheet data to compare against
 * @param {HtmlParserService} htmlParser - HTML parser service instance
 * @returns {Promise<Array>} Array of verification results
 */
async function processUrlsForVerification(validUrls, sourceData, htmlParser) {
  const results = [];

  // Extract just the URLs for parsing
  const urlsToProcess = validUrls.map(urlData => urlData.url);

  // Parse all URLs with concurrency control
  console.log('Parsing HTML from URLs...');
  const parsedResults = await htmlParser.parseUrls(urlsToProcess, 3); // 3 concurrent requests

  // Process each parsed result
  for (let i = 0; i < validUrls.length; i++) {
    const urlData = validUrls[i];
    const parsedData = parsedResults.find(result => result.url === urlData.url);

    try {
      if (!parsedData || !parsedData.success) {
        // HTML parsing failed
        results.push({
          rowIndex: urlData.rowIndex,
          url: urlData.url,
          status: 'failed',
          verification: 'HTML parsing failed',
          h1: null,
          metaTitle: null,
          metaDescription: null,
          timestamp: new Date().toISOString(),
          notes: parsedData ? parsedData.error : 'Unknown parsing error'
        });
        continue;
      }

      // HTML parsing succeeded - now do basic verification
      const verification = performBasicVerification(parsedData, sourceData);

      results.push({
        rowIndex: urlData.rowIndex,
        url: urlData.url,
        status: verification.status,
        verification: verification.summary,
        h1: parsedData.h1 || 'No H1 found',
        metaTitle: parsedData.metaTitle || 'No title found',
        metaDescription: parsedData.metaDescription || 'No description found',
        timestamp: new Date().toISOString(),
        notes: verification.details
      });

    } catch (error) {
      console.error(`Error processing URL ${urlData.url}:`, error);
      
      results.push({
        rowIndex: urlData.rowIndex,
        url: urlData.url,
        status: 'failed',
        verification: 'Processing error',
        timestamp: new Date().toISOString(),
        notes: `Error: ${error.message}`
      });
    }
  }

  return results;
}

/**
 * Performs basic verification by comparing parsed content with source data
 * (This is a placeholder for LLM-based verification)
 * @param {Object} parsedData - Parsed HTML data
 * @param {Array} sourceData - Source sheet offers data
 * @returns {Object} Verification result
 */
function performBasicVerification(parsedData, sourceData) {
  const { h1, metaTitle, metaDescription } = parsedData;
  const contentText = `${h1 || ''} ${metaTitle || ''} ${metaDescription || ''}`.toLowerCase();

  // Basic keyword matching (placeholder for LLM verification)
  const foundBrands = [];
  const foundOffers = [];

  for (const offer of sourceData) {
    // Check for brand mentions
    if (offer.brand && contentText.includes(offer.brand.toLowerCase())) {
      foundBrands.push(offer.brand);
    }

    // Check for offer keywords
    if (offer.offer) {
      const offerKeywords = offer.offer.toLowerCase().split(' ').filter(word => word.length > 3);
      for (const keyword of offerKeywords) {
        if (contentText.includes(keyword)) {
          foundOffers.push(keyword);
        }
      }
    }
  }

  // Determine verification status
  let status = 'verified';
  let summary = 'Content verified';
  let details = '';

  if (foundBrands.length === 0 && foundOffers.length === 0) {
    status = 'failed';
    summary = 'No matching content found';
    details = 'No brands or offers from source sheet found in page content';
  } else {
    const brandText = foundBrands.length > 0 ? `Brands: ${foundBrands.join(', ')}` : '';
    const offerText = foundOffers.length > 0 ? `Keywords: ${foundOffers.slice(0, 3).join(', ')}` : '';
    details = [brandText, offerText].filter(Boolean).join(' | ');
    
    if (foundBrands.length === 0) {
      summary = 'Partial match - no brand mentions';
    } else if (foundOffers.length === 0) {
      summary = 'Partial match - brand found but no offer details';
    }
  }

  return {
    status,
    summary,
    details
  };
}

/**
 * Health check endpoint
 * @returns {Response} Health status
 */
function handleHealthCheck() {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: ['html-parsing', 'basic-verification']
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
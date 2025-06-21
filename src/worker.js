// worker.js
// Main Cloudflare Worker entry point - handles HTTP routing and orchestrates verification

import { SheetsService } from './services/sheets-service.js';
import { HtmlParserService } from './services/html-parser.js';
import { LlmService } from './services/llm-service.js';
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
          return handleHealthCheck(env);
          
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

    // Initialize LLM service (will auto-detect provider from env)
    let llmService;
    try {
      llmService = LlmService.fromEnv(env);
      console.log(`LLM service initialized with provider: ${llmService.getProviderInfo().provider}`);
    } catch (error) {
      console.warn('LLM service not available:', error.message);
      llmService = null;
    }

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

    // Process each URL with HTML parsing and LLM verification
    console.log(`Starting verification for ${validUrls.length} URLs...`);
    const verificationResults = await processUrlsForVerification(validUrls, sourceData, htmlParser, llmService);

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
 * Processes URLs for verification with HTML parsing and LLM analysis
 * @param {Array} validUrls - Array of valid URL objects
 * @param {Array} sourceData - Source sheet data to compare against
 * @param {HtmlParserService} htmlParser - HTML parser service instance
 * @param {LlmService|null} llmService - LLM service instance (null if not available)
 * @returns {Promise<Array>} Array of verification results
 */
async function processUrlsForVerification(validUrls, sourceData, htmlParser, llmService) {
  const results = [];

  // Extract just the URLs for parsing
  const urlsToProcess = validUrls.map(urlData => urlData.url);

  // Step 1: Parse all URLs with HTML parser
  console.log('Parsing HTML from URLs...');
  const parsedResults = await htmlParser.parseUrls(urlsToProcess, 3); // 3 concurrent requests

  // Step 2: Process each parsed result with LLM verification
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

      // HTML parsing succeeded - now do LLM verification or fallback
      let verification;
      
      if (llmService) {
        console.log(`LLM verification for: ${urlData.url}`);
        verification = await llmService.verifyOfferAccuracy(parsedData, sourceData, urlData.url);
      } else {
        console.log(`Basic verification for: ${urlData.url} (no LLM available)`);
        verification = performBasicVerification(parsedData, sourceData);
      }

      results.push({
        rowIndex: urlData.rowIndex,
        url: urlData.url,
        status: verification.status,
        verification: verification.summary,
        h1: parsedData.h1 || 'No H1 found',
        metaTitle: parsedData.metaTitle || 'No title found',
        metaDescription: parsedData.metaDescription || 'No description found',
        timestamp: new Date().toISOString(),
        notes: formatVerificationNotes(verification, llmService)
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
 * Formats verification notes with additional details
 * @param {Object} verification - Verification result
 * @param {LlmService|null} llmService - LLM service instance
 * @returns {string} Formatted notes
 */
function formatVerificationNotes(verification, llmService) {
  const notes = [];
  
  if (llmService) {
    const provider = llmService.getProviderInfo();
    notes.push(`LLM: ${provider.provider} (${provider.model})`);
    
    if (verification.confidence !== undefined) {
      notes.push(`Confidence: ${verification.confidence}%`);
    }
    
    if (verification.foundBrands && verification.foundBrands.length > 0) {
      notes.push(`Brands: ${verification.foundBrands.join(', ')}`);
    }
    
    if (verification.discrepancies && verification.discrepancies.length > 0) {
      notes.push(`Issues: ${verification.discrepancies.join('; ')}`);
    }
    
    if (verification.details) {
      notes.push(verification.details);
    }
  } else {
    notes.push('Basic keyword matching (no LLM)');
    if (verification.details) {
      notes.push(verification.details);
    }
  }
  
  return notes.join(' | ');
}

/**
 * Performs basic verification by comparing parsed content with source data
 * (Fallback when LLM service is not available)
 * @param {Object} parsedData - Parsed HTML data
 * @param {Array} sourceData - Source sheet offers data
 * @returns {Object} Verification result
 */
function performBasicVerification(parsedData, sourceData) {
  const { h1, metaTitle, metaDescription } = parsedData;
  const contentText = `${h1 || ''} ${metaTitle || ''} ${metaDescription || ''}`.toLowerCase();

  // Basic keyword matching
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
    details,
    confidence: foundBrands.length > 0 && foundOffers.length > 0 ? 80 : 50
  };
}

/**
 * Health check endpoint
 * @param {Object} env - Environment variables
 * @returns {Response} Health status
 */
function handleHealthCheck(env) {
  const services = {
    sheets: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY)
  };

  const llmProvider = env.LLM_PROVIDER || 'auto';

  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    features: ['html-parsing', 'llm-verification', 'multi-provider'],
    services,
    llmProvider
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
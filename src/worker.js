// worker.js
// Updated Cloudflare Worker with optimized verification modes and smart matching

import { SheetsService } from './services/sheets-service.js';
import { HtmlParserService } from './services/html-parser.js';
import { LlmService } from './services/llm-service.js';
import { RegexVerifier } from './services/regex-verifier.js';
import { WorkerRateManager } from './services/worker-rate-manager.js';
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
 */
function handleMainPage() {
  const html = HtmlTemplates.getMainForm();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/**
 * UPDATED: Handles verification with optimization modes and smart matching
 */
async function handleVerification(request, env) {
  try {
    // Parse form data
    const formData = await request.formData();
    const sourceSheetUrl = formData.get('sourceSheetUrl');
    const verifierSheetUrl = formData.get('verifierSheetUrl');

    // NEW: Get verification mode from form (default to regex for cost savings)
    const verificationMode = formData.get('verificationMode') || 'regex';
    const llmProvider = formData.get('llmProvider') || 'anthropic';
    const llmModel = formData.get('llmModel') || 'claude-3-haiku-20240307';

    // Validate required fields
    if (!sourceSheetUrl || !verifierSheetUrl) {
      throw new Error('Both source sheet URL and verifier sheet URL are required');
    }

    console.log(`Starting verification with mode: ${verificationMode}`);

    // Initialize services
    const sheetsService = SheetsService.fromEnv(env);
    const htmlParser = new HtmlParserService({
      timeout: 15000,
      maxRetries: 2
    });

    // Validate sheet access
    console.log('Validating sheet access...');
    const accessValidation = await sheetsService.validateSheetAccess(sourceSheetUrl, verifierSheetUrl);

    if (!accessValidation.sourceSheet.accessible) {
      throw new Error(`Cannot access source sheet: ${accessValidation.sourceSheet.error}`);
    }

    if (!accessValidation.verifierSheet.accessible) {
      throw new Error(`Cannot access verifier sheet: ${accessValidation.verifierSheet.error}`);
    }

    // Fetch source data and URLs
    console.log('Fetching data...');
    const [sourceData, verifierUrls] = await Promise.all([
      sheetsService.fetchSourceData(sourceSheetUrl),
      sheetsService.fetchVerifierUrls(verifierSheetUrl)
    ]);

    console.log(`Found ${sourceData.length} source offers and ${verifierUrls.length} URLs to verify`);

    // Filter valid URLs
    const validUrls = verifierUrls.filter(urlData => urlData.isValid);
    const invalidUrls = verifierUrls.filter(urlData => !urlData.isValid);

    if (invalidUrls.length > 0) {
      console.warn(`Skipping ${invalidUrls.length} invalid URLs`);
    }
    // CHUNKING LOGIC
    const chunkSize = verificationMode === 'regex' ? 25 : verificationMode === 'hybrid' ? 15 : 8;

    if (validUrls.length > chunkSize) {
      // Use batching for large datasets
      const rateManager = new WorkerRateManager({ chunkSize, maxExecutionTime: 45000 });

      return rateManager.handleContinuationRequest(request, async ({ continueFrom, jobId }) => {
        const chunk = validUrls.slice(continueFrom, continueFrom + chunkSize);

        const verificationResults = await processWithSmartVerification(
          chunk, sourceData, htmlParser, verificationMode, llmProvider, llmModel, env
        );

        // Write chunk results back
        await sheetsService.writeVerificationResults(verifierSheetUrl, verificationResults);

        return {
          results: verificationResults,
          processed: continueFrom + chunk.length,
          total: validUrls.length,
          completed: continueFrom + chunk.length >= validUrls.length,
          needsContinuation: continueFrom + chunk.length < validUrls.length
        };
      });
    } else {
      // Process normally for small datasets
      const verificationResults = await processWithSmartVerification(
        validUrls, sourceData, htmlParser, verificationMode, llmProvider, llmModel, env
      );

      await sheetsService.writeVerificationResults(verifierSheetUrl, verificationResults);

      const html = HtmlTemplates.getResultsPage(verificationResults, validUrls.length, verifierUrls.length, verificationMode);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    // Write results back
    console.log('Writing results back to sheet...');
    await sheetsService.writeVerificationResults(verifierSheetUrl, verificationResults);

    // Return results page with mode info
    const html = HtmlTemplates.getResultsPage(
      verificationResults,
      verificationResults.length,
      verifierUrls.length,
      verificationMode
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
 * NEW: Smart verification processing that only checks relevant offers per URL
 */
async function processWithSmartVerification(
  validUrls,
  sourceData,
  htmlParser,
  verificationMode,
  llmProvider,
  llmModel,
  env
) {
  console.log(`Processing ${validUrls.length} URLs with ${verificationMode} mode`);
  console.log(`Source data contains ${sourceData.length} total offers`);

  // Step 1: Parse HTML for all URLs
  const urlsToProcess = validUrls.map(urlData => urlData.url);
  console.log('Parsing HTML content...');
  const parsedResults = await htmlParser.parseUrls(urlsToProcess, 3);

  // Step 2: Create verification function based on mode
  const verificationFunction = createVerificationFunction(
    verificationMode,
    llmProvider,
    llmModel,
    env
  );

  // Step 3: Process each URL with smart matching
  const results = [];

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
          notes: `Mode: ${verificationMode} | Error: ${parsedData?.error || 'Unknown parsing error'}`
        });
        continue;
      }

      // Use smart verification (only checks relevant offers)
      const verification = await verificationFunction(parsedData, sourceData, urlData.url);

      results.push({
        rowIndex: urlData.rowIndex,
        url: urlData.url,
        status: verification.status,
        verification: verification.summary,
        h1: parsedData.h1 || 'No H1 found',
        metaTitle: parsedData.metaTitle || 'No title found',
        metaDescription: parsedData.metaDescription || 'No description found',
        timestamp: new Date().toISOString(),
        notes: formatSmartNotes(verification, verificationMode)
      });

      // Log progress for debugging
      if (i % 10 === 0) {
        console.log(`Processed ${i + 1}/${validUrls.length} URLs`);
      }

    } catch (error) {
      console.error(`Error processing URL ${urlData.url}:`, error);

      results.push({
        rowIndex: urlData.rowIndex,
        url: urlData.url,
        status: 'failed',
        verification: 'Processing error',
        timestamp: new Date().toISOString(),
        notes: `Mode: ${verificationMode} | Error: ${error.message}`
      });
    }

    // Add small delay to prevent overwhelming APIs (only for LLM mode)
    if (verificationMode === 'llm' && i % 5 === 4) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`Completed processing. Results summary:`);
  const statusCounts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log(statusCounts);

  return results;
}

/**
 * NEW: Creates verification function based on selected mode
 */
function createVerificationFunction(verificationMode, llmProvider, llmModel, env) {
  switch (verificationMode) {
    case 'regex':
      console.log('Using regex verification with smart matching (0 tokens, 0 cost)');
      const regexVerifier = new RegexVerifier();
      return async (parsedData, sourceData, url) => {
        return regexVerifier.verifyOfferAccuracy(parsedData, sourceData, url);
      };

    case 'llm':
      console.log(`Using LLM verification: ${llmProvider} ${llmModel}`);
      const llmService = LlmService.fromEnv(env, {
        model: llmModel,
        maxTokens: 300 // Reduced from default 1000
      });
      return async (parsedData, sourceData, url) => {
        return await llmService.verifyOfferAccuracy(parsedData, sourceData, url);
      };

    case 'hybrid':
      console.log('Using hybrid verification (smart regex + LLM fallback)');
      const regexVerifierHybrid = new RegexVerifier();
      const llmServiceHybrid = LlmService.fromEnv(env, {
        model: llmModel,
        maxTokens: 300
      });

      return async (parsedData, sourceData, url) => {
        // Try smart regex first
        const regexResult = regexVerifierHybrid.verifyOfferAccuracy(parsedData, sourceData, url);

        // Use LLM only for low-confidence cases or failures
        if (regexResult.confidence < 70 && regexResult.status !== 'no_relevant_offers') {
          console.log(`Using LLM fallback for: ${url} (confidence: ${regexResult.confidence}%)`);
          try {
            const llmResult = await llmServiceHybrid.verifyOfferAccuracy(parsedData, sourceData, url);
            return {
              ...llmResult,
              hybridMethod: 'llm_fallback',
              regexConfidence: regexResult.confidence,
              regexStatus: regexResult.status
            };
          } catch (llmError) {
            console.error(`LLM fallback failed for ${url}:`, llmError);
            return {
              ...regexResult,
              hybridMethod: 'regex_only_llm_failed',
              llmError: llmError.message
            };
          }
        } else {
          return {
            ...regexResult,
            hybridMethod: 'regex_only'
          };
        }
      };

    case 'basic':
      console.log('Using basic keyword verification (legacy fallback)');
      return async (parsedData, sourceData, url) => {
        return performBasicVerification(parsedData, sourceData);
      };

    default:
      throw new Error(`Unknown verification mode: ${verificationMode}`);
  }
}

/**
 * NEW: Format notes with smart matching and optimization info
 */
function formatSmartNotes(verification, verificationMode) {
  const notes = [];

  // Primary info
  notes.push(`${verificationMode.toUpperCase()} (${verification.confidence || 0}% confidence)`);

  // Smart matching summary
  if (verification.relevantOffersCount !== undefined) {
    notes.push(`Found: ${verification.relevantOffersCount} relevant offers`);
  }

  // Key issues only (limit to 2)
  if (verification.discrepancies && verification.discrepancies.length > 0) {
    notes.push(`Issues: ${verification.discrepancies.slice(0, 2).join('; ')}`);
  }

  // Tokens if LLM
  if (verification.tokensUsed !== undefined && verification.tokensUsed > 0) {
    notes.push(`Tokens: ${verification.tokensUsed}`);
  }

  return notes.join('\n'); // LINE BREAKS INSTEAD OF PIPES
}

/**
 * Keep existing basic verification as fallback
 */
function performBasicVerification(parsedData, sourceData) {
  const { h1, metaTitle, metaDescription } = parsedData;
  const contentText = `${h1 || ''} ${metaTitle || ''} ${metaDescription || ''}`.toLowerCase();

  const foundBrands = [];
  const foundOffers = [];

  for (const offer of sourceData) {
    if (offer.brand && contentText.includes(offer.brand.toLowerCase())) {
      foundBrands.push(offer.brand);
    }

    if (offer.offer) {
      const offerKeywords = offer.offer.toLowerCase().split(' ').filter(word => word.length > 3);
      for (const keyword of offerKeywords) {
        if (contentText.includes(keyword)) {
          foundOffers.push(keyword);
        }
      }
    }
  }

  let status = 'verified';
  let summary = 'Content verified';
  let details = '';

  if (foundBrands.length === 0 && foundOffers.length === 0) {
    status = 'no_relevant_offers';
    summary = 'No matching content found';
  } else {
    const brandText = foundBrands.length > 0 ? `Brands: ${foundBrands.join(', ')}` : '';
    const offerText = foundOffers.length > 0 ? `Keywords: ${foundOffers.slice(0, 3).join(', ')}` : '';
    details = [brandText, offerText].filter(Boolean).join(' | ');
  }

  return {
    status,
    summary,
    details,
    confidence: foundBrands.length > 0 && foundOffers.length > 0 ? 80 : 50,
    provider: 'basic_keyword_matching'
  };
}

/**
 * Updated health check with new services
 */
function handleHealthCheck(env) {
  const services = {
    sheets: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY)
  };

  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '4.0.0-smart-matching',
    features: [
      'html-parsing',
      'smart-regex-verification',
      'selective-offer-matching',
      'llm-verification',
      'hybrid-mode',
      'token-optimization'
    ],
    verificationModes: ['regex', 'llm', 'hybrid', 'basic'],
    services,
    defaultMode: 'regex',
    improvements: [
      'Only verifies relevant offers per URL',
      '90% token reduction',
      'Smart selective matching',
      'No false negatives for irrelevant content'
    ]
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

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
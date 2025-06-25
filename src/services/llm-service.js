// llm-service.js
// Service for LLM-powered offer verification with support for Anthropic Claude and OpenAI GPT

export class LlmService {
  constructor(provider, apiKey, options = {}) {
    this.provider = provider.toLowerCase();
    this.apiKey = apiKey;
    this.timeout = options.timeout || 30000; // 30 second timeout
    
    // Provider-specific configuration
    if (this.provider === 'anthropic') {
      this.baseUrl = 'https://api.anthropic.com/v1/messages';
      this.model = options.model || 'claude-3-5-sonnet-20241022';
      this.maxTokens = options.maxTokens || 1000;
    } else if (this.provider === 'openai') {
      this.baseUrl = 'https://api.openai.com/v1/chat/completions';
      this.model = options.model || 'gpt-4o-mini';
      this.maxTokens = options.maxTokens || 1000;
    } else {
      throw new Error(`Unsupported LLM provider: ${provider}. Use 'anthropic' or 'openai'`);
    }
  }

  /**
   * Creates LlmService from environment variables
   * @param {Object} env - Cloudflare Worker environment variables
   * @param {Object} options - Optional configuration
   * @returns {LlmService}
   */
  static fromEnv(env, options = {}) {
    // Try to determine provider from available API keys
    const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY);
    const hasOpenAIKey = Boolean(env.OPENAI_API_KEY);
    
    // Allow override via environment variable
    const preferredProvider = env.LLM_PROVIDER?.toLowerCase();
    
    let provider, apiKey;
    
    if (preferredProvider === 'anthropic' && hasAnthropicKey) {
      provider = 'anthropic';
      apiKey = env.ANTHROPIC_API_KEY;
    } else if (preferredProvider === 'openai' && hasOpenAIKey) {
      provider = 'openai';
      apiKey = env.OPENAI_API_KEY;
    } else if (hasAnthropicKey && !hasOpenAIKey) {
      provider = 'anthropic';
      apiKey = env.ANTHROPIC_API_KEY;
    } else if (hasOpenAIKey && !hasAnthropicKey) {
      provider = 'openai';
      apiKey = env.OPENAI_API_KEY;
    } else if (hasAnthropicKey && hasOpenAIKey) {
      // Default to Anthropic if both are available
      provider = 'anthropic';
      apiKey = env.ANTHROPIC_API_KEY;
    } else {
      throw new Error('No LLM API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable');
    }
    
    console.log(`Using LLM provider: ${provider}`);
    return new LlmService(provider, apiKey, options);
  }

  /**
   * Verifies if webpage content matches source sheet offers
   * @param {Object} htmlData - Parsed HTML data from webpage
   * @param {Array} sourceOffers - Array of offers from source sheet
   * @param {string} url - The URL being verified
   * @returns {Promise<Object>} Verification result
   */
  async verifyOfferAccuracy(htmlData, sourceOffers, url) {
    try {
      const prompt = this.buildVerificationPrompt(htmlData, sourceOffers, url);
      const response = await this.callLLM(prompt);
      return this.parseVerificationResponse(response);
    } catch (error) {
      console.error('LLM verification error:', error);
      return {
        status: 'failed',
        summary: 'LLM verification failed',
        details: `Error: ${error.message}`,
        confidence: 0,
        brandMatch: false,
        offerMatch: false,
        termsMatch: false,
        provider: this.provider
      };
    }
  }

  /**
 * Builds the prompt for offer verification (UPDATED VERSION)
 * @param {Object} htmlData - Parsed HTML data
 * @param {Array} sourceOffers - Source sheet offers
 * @param {string} url - URL being verified
 * @returns {string} Formatted prompt
 */
buildVerificationPrompt(htmlData, sourceOffers, url) {
  const { h1, metaTitle, metaDescription, mainContent } = htmlData;
  
  // Format source offers for context
  const formattedOffers = sourceOffers.map(offer => 
    `Brand: ${offer.brand || 'N/A'}\nOffer: ${offer.offer || 'N/A'}\nStates: ${offer.states || 'N/A'}\nKey T&C: ${offer.keyTandC || 'N/A'}`
  ).join('\n\n---\n\n');

  // Prepare webpage content - prioritize mainContent if available
  let webpageContent;
  if (mainContent && mainContent.trim().length > 50) {
    // Use the full extracted content
    webpageContent = `MAIN CONTENT: ${mainContent}

META DATA:
H1: ${h1 || 'Not found'}
Title: ${metaTitle || 'Not found'}
Meta Description: ${metaDescription || 'Not found'}`;
  } else {
    // Fallback to meta data only if mainContent extraction failed
    webpageContent = `H1: ${h1 || 'Not found'}
Title: ${metaTitle || 'Not found'}
Meta Description: ${metaDescription || 'Not found'}
Note: Full page content extraction failed, using meta data only.`;
  }

  return `You are verifying the accuracy of offer information on a webpage against source data.

URL: ${url}

WEBPAGE CONTENT:
${webpageContent}

SOURCE OFFERS TO VERIFY AGAINST:
${formattedOffers}

VERIFICATION TASK:
Compare the webpage content against the source offers and determine:

1. BRAND MATCH: Does the webpage mention any of the brands from the source data?
2. OFFER MATCH: Does the webpage describe offers that match the source data?
3. TERMS MATCH: Are key terms and conditions accurately represented?

Focus on the MAIN CONTENT section which contains the actual visible text users see on the page.

Respond in this exact JSON format:
{
  "status": "verified|partial|failed",
  "summary": "Brief 1-sentence summary",
  "details": "Detailed explanation of what matches or doesn't match",
  "confidence": 85,
  "brandMatch": true,
  "offerMatch": true,
  "termsMatch": false,
  "foundBrands": ["BetMGM", "Caesars"],
  "foundOffers": ["First bet up to $1000", "Deposit match bonus"],
  "discrepancies": ["T&C mention different states than source"]
}

Be strict in your verification. Only mark as "verified" if the content clearly and accurately represents the source offers.`;
}

  /**
   * Calls the appropriate LLM API based on provider
   * @param {string} prompt - The verification prompt
   * @returns {Promise<string>} API response content
   */
  async callLLM(prompt) {
    if (this.provider === 'anthropic') {
      return await this.callAnthropicAPI(prompt);
    } else if (this.provider === 'openai') {
      return await this.callOpenAIAPI(prompt);
    } else {
      throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  /**
   * Calls the Anthropic API
   * @param {string} prompt - The verification prompt
   * @returns {Promise<string>} API response content
   */
  async callAnthropicAPI(prompt) {
    const requestBody = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('Invalid response format from Anthropic API');
    }

    return data.content[0].text;
  }

  /**
   * Calls the OpenAI API
   * @param {string} prompt - The verification prompt
   * @returns {Promise<string>} API response content
   */
  async callOpenAIAPI(prompt) {
    const requestBody = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at verifying marketing offers and promotional content for accuracy.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1 // Low temperature for consistent verification
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response format from OpenAI API');
    }

    return data.choices[0].message.content;
  }

  /**
   * Parses the LLM response into structured verification result
   * @param {string} response - Raw LLM response
   * @returns {Object} Parsed verification result
   */
  parseVerificationResponse(response) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate required fields and provide defaults
      return {
        status: parsed.status || 'failed',
        summary: parsed.summary || 'Unable to verify',
        details: parsed.details || 'No details provided',
        confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
        brandMatch: Boolean(parsed.brandMatch),
        offerMatch: Boolean(parsed.offerMatch),
        termsMatch: Boolean(parsed.termsMatch),
        foundBrands: Array.isArray(parsed.foundBrands) ? parsed.foundBrands : [],
        foundOffers: Array.isArray(parsed.foundOffers) ? parsed.foundOffers : [],
        discrepancies: Array.isArray(parsed.discrepancies) ? parsed.discrepancies : [],
        provider: this.provider
      };
    } catch (error) {
      console.error('Error parsing LLM response:', error);
      console.log('Raw response:', response);
      
      // Fallback: try to extract basic information from text
      return this.extractBasicVerification(response);
    }
  }

  /**
   * Fallback method to extract basic verification from text response
   * @param {string} response - Raw LLM response
   * @returns {Object} Basic verification result
   */
  extractBasicVerification(response) {
    const lowerResponse = response.toLowerCase();
    
    // Look for status indicators
    let status = 'failed';
    if (lowerResponse.includes('verified') && !lowerResponse.includes('not verified')) {
      status = 'verified';
    } else if (lowerResponse.includes('partial')) {
      status = 'partial';
    }

    // Look for confidence indicators
    const confidenceMatch = response.match(/(\d+)%/);
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;

    return {
      status,
      summary: 'Basic text analysis (JSON parsing failed)',
      details: response.substring(0, 200) + '...',
      confidence,
      brandMatch: lowerResponse.includes('brand') && lowerResponse.includes('match'),
      offerMatch: lowerResponse.includes('offer') && lowerResponse.includes('match'),
      termsMatch: lowerResponse.includes('terms') && lowerResponse.includes('match'),
      foundBrands: [],
      foundOffers: [],
      discrepancies: [],
      provider: this.provider
    };
  }

  /**
   * Verifies multiple URLs with batch processing
   * @param {Array} htmlDataArray - Array of parsed HTML data
   * @param {Array} sourceOffers - Source sheet offers
   * @returns {Promise<Array>} Array of verification results
   */
  async verifyMultipleOffers(htmlDataArray, sourceOffers) {
    const results = [];
    
    // Process in smaller batches to respect API rate limits
    const batchSize = this.provider === 'openai' ? 3 : 5; // OpenAI has stricter rate limits
    
    for (let i = 0; i < htmlDataArray.length; i += batchSize) {
      const batch = htmlDataArray.slice(i, i + batchSize);
      
      const batchPromises = batch.map(htmlData => 
        this.verifyOfferAccuracy(htmlData, sourceOffers, htmlData.url)
      );

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Small delay between batches to respect rate limits
        if (i + batchSize < htmlDataArray.length) {
          const delay = this.provider === 'openai' ? 2000 : 1000; // Longer delay for OpenAI
          await this.delay(delay);
        }
      } catch (error) {
        console.error(`Batch LLM verification error:`, error);
        // Add failed results for this batch
        batch.forEach(htmlData => {
          results.push({
            status: 'failed',
            summary: 'Batch processing failed',
            details: `Error: ${error.message}`,
            confidence: 0,
            brandMatch: false,
            offerMatch: false,
            termsMatch: false,
            provider: this.provider
          });
        });
      }
    }

    return results;
  }

  /**
   * Utility method for delays
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test method to verify API connectivity
   * @returns {Promise<boolean>} True if API is accessible
   */
  async testConnection() {
    try {
      const testPrompt = "Respond with exactly: {\"status\":\"connected\"}";
      const response = await this.callLLM(testPrompt);
      return response.includes('connected');
    } catch (error) {
      console.error('LLM service connection test failed:', error);
      return false;
    }
  }

  /**
   * Gets provider information
   * @returns {Object} Provider details
   */
  getProviderInfo() {
    return {
      provider: this.provider,
      model: this.model,
      maxTokens: this.maxTokens,
      baseUrl: this.baseUrl
    };
  }
}
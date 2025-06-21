// html-parser.js
// Service for fetching and parsing HTML content using Cloudflare HTMLRewriter

export class HtmlParserService {
  constructor(options = {}) {
    this.timeout = options.timeout || 10000; // 10 second timeout
    this.userAgent = options.userAgent || 'Mozilla/5.0 (compatible; SheetsVerifier/1.0)';
    this.maxRetries = options.maxRetries || 2;
  }

  /**
   * Parses HTML from a URL and extracts key elements
   * @param {string} url - URL to parse
   * @returns {Promise<Object>} Parsed HTML data
   */
  async parseUrl(url) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const htmlData = await this.fetchAndParseHtml(url);
        return {
          url,
          success: true,
          ...htmlData,
          fetchedAt: new Date().toISOString()
        };
      } catch (error) {
        lastError = error;
        console.warn(`Attempt ${attempt} failed for ${url}:`, error.message);
        
        if (attempt < this.maxRetries) {
          // Wait before retry (exponential backoff)
          await this.delay(1000 * attempt);
        }
      }
    }

    // All retries failed
    return {
      url,
      success: false,
      error: lastError.message,
      h1: null,
      metaTitle: null,
      metaDescription: null,
      fetchedAt: new Date().toISOString()
    };
  }

  /**
   * Fetches HTML and extracts elements using HTMLRewriter
   * @param {string} url - URL to fetch
   * @returns {Promise<Object>} Extracted HTML elements
   */
  async fetchAndParseHtml(url) {
    // Fetch the HTML
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(this.timeout)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Not an HTML page: ${contentType}`);
    }

    // Storage for extracted data
    const extractedData = {
      h1: null,
      metaTitle: null,
      metaDescription: null,
      h1Elements: [],
      responseStatus: response.status,
      contentType: contentType
    };

    // Create HTMLRewriter with element handlers
    const rewriter = new HTMLRewriter()
      .on('h1', new H1Handler(extractedData))
      .on('title', new TitleHandler(extractedData))
      .on('meta[name="description"]', new MetaDescriptionHandler(extractedData))
      .on('meta[property="og:title"]', new OgTitleHandler(extractedData))
      .on('meta[property="og:description"]', new OgDescriptionHandler(extractedData));

    // Process the HTML
    const transformedResponse = rewriter.transform(response);
    
    // We need to consume the response to trigger the rewriter
    await transformedResponse.text();

    // Clean up extracted data
    this.cleanExtractedData(extractedData);

    return extractedData;
  }

  /**
   * Cleans and validates extracted data
   * @param {Object} extractedData - Raw extracted data
   */
  cleanExtractedData(extractedData) {
    // Clean H1 - use first non-empty H1
    if (extractedData.h1Elements.length > 0) {
      extractedData.h1 = extractedData.h1Elements.find(h1 => h1.trim().length > 0) || null;
    }

    // Fallback: Use og:title if no title tag
    if (!extractedData.metaTitle && extractedData.ogTitle) {
      extractedData.metaTitle = extractedData.ogTitle;
    }

    // Fallback: Use og:description if no meta description
    if (!extractedData.metaDescription && extractedData.ogDescription) {
      extractedData.metaDescription = extractedData.ogDescription;
    }

    // Trim and validate all text fields
    ['h1', 'metaTitle', 'metaDescription'].forEach(field => {
      if (extractedData[field]) {
        extractedData[field] = extractedData[field].trim();
        if (extractedData[field].length === 0) {
          extractedData[field] = null;
        }
      }
    });

    // Remove temporary arrays and og data
    delete extractedData.h1Elements;
    delete extractedData.ogTitle;
    delete extractedData.ogDescription;
  }

  /**
   * Processes multiple URLs in parallel with concurrency control
   * @param {Array} urls - Array of URLs to parse
   * @param {number} concurrency - Maximum concurrent requests
   * @returns {Promise<Array>} Array of parsed results
   */
  async parseUrls(urls, concurrency = 3) {
    const results = [];
    
    // Process URLs in batches to control concurrency
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const batchPromises = batch.map(url => this.parseUrl(url));
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Small delay between batches to be respectful
        if (i + concurrency < urls.length) {
          await this.delay(500);
        }
      } catch (error) {
        console.error(`Batch processing error:`, error);
        // Continue with next batch even if current batch fails
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
}

/**
 * HTMLRewriter handler for H1 elements
 */
class H1Handler {
  constructor(extractedData) {
    this.extractedData = extractedData;
    this.textContent = '';
  }

  text(text) {
    this.textContent += text.text;
  }

  element(element) {
    // Reset for new H1
    this.textContent = '';
  }

  end() {
    if (this.textContent.trim()) {
      this.extractedData.h1Elements.push(this.textContent.trim());
    }
  }
}

/**
 * HTMLRewriter handler for title elements
 */
class TitleHandler {
  constructor(extractedData) {
    this.extractedData = extractedData;
    this.textContent = '';
  }

  text(text) {
    this.textContent += text.text;
  }

  element(element) {
    this.textContent = '';
  }

  end() {
    if (this.textContent.trim()) {
      this.extractedData.metaTitle = this.textContent.trim();
    }
  }
}

/**
 * HTMLRewriter handler for meta description
 */
class MetaDescriptionHandler {
  constructor(extractedData) {
    this.extractedData = extractedData;
  }

  element(element) {
    const content = element.getAttribute('content');
    if (content && content.trim()) {
      this.extractedData.metaDescription = content.trim();
    }
  }
}

/**
 * HTMLRewriter handler for Open Graph title
 */
class OgTitleHandler {
  constructor(extractedData) {
    this.extractedData = extractedData;
  }

  element(element) {
    const content = element.getAttribute('content');
    if (content && content.trim()) {
      this.extractedData.ogTitle = content.trim();
    }
  }
}

/**
 * HTMLRewriter handler for Open Graph description
 */
class OgDescriptionHandler {
  constructor(extractedData) {
    this.extractedData = extractedData;
  }

  element(element) {
    const content = element.getAttribute('content');
    if (content && content.trim()) {
      this.extractedData.ogDescription = content.trim();
    }
  }
}
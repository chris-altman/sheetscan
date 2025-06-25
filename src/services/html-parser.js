// html-parser.js
// Enhanced service for fetching and parsing HTML content using Cloudflare HTMLRewriter

export class HtmlParserService {
  constructor(options = {}) {
    this.timeout = options.timeout || 10000; // 10 second timeout
    this.userAgent = options.userAgent || 'Mozilla/5.0 (compatible; SheetsVerifier/1.0)';
    this.maxRetries = options.maxRetries || 2;
    this.maxContentLength = options.maxContentLength || 8000; // Limit total content length
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
      mainContent: null,
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
      mainContent: '', // New: all meaningful text content
      h1Elements: [],
      responseStatus: response.status,
      contentType: contentType,
      textCollector: [] // Temporary array to collect all text
    };

    // Create HTMLRewriter with enhanced handlers
    const rewriter = new HTMLRewriter()
      // Original handlers
      .on('h1', new H1Handler(extractedData))
      .on('title', new TitleHandler(extractedData))
      .on('meta[name="description"]', new MetaDescriptionHandler(extractedData))
      .on('meta[property="og:title"]', new OgTitleHandler(extractedData))
      .on('meta[property="og:description"]', new OgDescriptionHandler(extractedData))
      
      // New handlers for content extraction
      .on('h1, h2, h3, h4, h5, h6', new HeadingHandler(extractedData))
      .on('p', new ParagraphHandler(extractedData))
      .on('article', new ContentHandler(extractedData))
      .on('main', new ContentHandler(extractedData))
      .on('[role="main"]', new ContentHandler(extractedData))
      .on('.content', new ContentHandler(extractedData))
      .on('#content', new ContentHandler(extractedData))
      .on('.post-content', new ContentHandler(extractedData))
      .on('.entry-content', new ContentHandler(extractedData))
      
      // Text from common content areas
      .on('div', new SelectiveTextHandler(extractedData))
      .on('span', new SelectiveTextHandler(extractedData))
      .on('li', new ListItemHandler(extractedData))
      
      // Skip navigation and unwanted content
      .on('nav', new SkipHandler())
      .on('header', new SkipHandler())
      .on('footer', new SkipHandler())
      .on('.navigation', new SkipHandler())
      .on('.nav', new SkipHandler())
      .on('.menu', new SkipHandler())
      .on('.sidebar', new SkipHandler())
      .on('.advertisement', new SkipHandler())
      .on('.ads', new SkipHandler())
      .on('script', new SkipHandler())
      .on('style', new SkipHandler())
      .on('noscript', new SkipHandler());

    // Process the HTML
    const transformedResponse = rewriter.transform(response);
    
    // We need to consume the response to trigger the rewriter
    await transformedResponse.text();

    // Process collected text
    this.processCollectedText(extractedData);

    // Clean up extracted data
    this.cleanExtractedData(extractedData);

    return extractedData;
  }

  /**
   * Processes all collected text into mainContent
   * @param {Object} extractedData - Data being extracted
   */
  processCollectedText(extractedData) {
    // Combine all collected text, removing duplicates and cleaning
    const allText = extractedData.textCollector
      .filter(text => text && text.trim().length > 10) // Filter out short snippets
      .map(text => text.trim())
      .filter((text, index, array) => array.indexOf(text) === index) // Remove duplicates
      .join(' ')
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Truncate if too long, but try to break at sentence boundaries
    if (allText.length > this.maxContentLength) {
      const truncated = allText.substring(0, this.maxContentLength);
      const lastSentence = truncated.lastIndexOf('.');
      const lastSpace = truncated.lastIndexOf(' ');
      
      if (lastSentence > this.maxContentLength * 0.8) {
        extractedData.mainContent = truncated.substring(0, lastSentence + 1);
      } else if (lastSpace > this.maxContentLength * 0.9) {
        extractedData.mainContent = truncated.substring(0, lastSpace) + '...';
      } else {
        extractedData.mainContent = truncated + '...';
      }
    } else {
      extractedData.mainContent = allText;
    }

    // Clean up temporary data
    delete extractedData.textCollector;
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
    ['h1', 'metaTitle', 'metaDescription', 'mainContent'].forEach(field => {
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

// ORIGINAL HANDLERS (unchanged)

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

// NEW ENHANCED HANDLERS

/**
 * Handler for main content areas
 */
class ContentHandler {
  constructor(extractedData) {
    this.extractedData = extractedData;
    this.textContent = '';
    this.isCollecting = true;
  }

  text(text) {
    if (this.isCollecting) {
      this.textContent += text.text;
    }
  }

  element(element) {
    this.textContent = '';
    this.isCollecting = true;
  }

  end() {
    if (this.textContent.trim() && this.textContent.trim().length > 10) {
      this.extractedData.textCollector.push(this.textContent.trim());
    }
  }
}

/**
 * Handler for selective text extraction from divs/spans
 */
class SelectiveTextHandler {
  constructor(extractedData) {
    this.extractedData = extractedData;
    this.textContent = '';
    this.shouldSkip = false;
  }

  text(text) {
    if (!this.shouldSkip) {
      this.textContent += text.text;
    }
  }

  element(element) {
    this.textContent = '';
    
    // Skip if this looks like navigation or unwanted content
    const className = element.getAttribute('class') || '';
    const id = element.getAttribute('id') || '';
    
    const skipPatterns = ['nav', 'menu', 'sidebar', 'footer', 'header', 'ad', 'advertisement', 'social', 'share', 'comment'];
    this.shouldSkip = skipPatterns.some(pattern => 
      className.toLowerCase().includes(pattern) || 
      id.toLowerCase().includes(pattern)
    );
  }

  end() {
    if (!this.shouldSkip && this.textContent.trim() && this.textContent.trim().length > 20) {
      this.extractedData.textCollector.push(this.textContent.trim());
    }
  }
}

/**
 * Handler for heading elements
 */
class HeadingHandler {
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
      this.extractedData.textCollector.push(this.textContent.trim());
    }
  }
}

/**
 * Handler for paragraph elements
 */
class ParagraphHandler {
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
    if (this.textContent.trim() && this.textContent.trim().length > 15) {
      this.extractedData.textCollector.push(this.textContent.trim());
    }
  }
}

/**
 * Handler for list item elements
 */
class ListItemHandler {
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
    if (this.textContent.trim() && this.textContent.trim().length > 10) {
      this.extractedData.textCollector.push(this.textContent.trim());
    }
  }
}

/**
 * Handler that skips unwanted content
 */
class SkipHandler {
  // This handler intentionally does nothing to skip unwanted content
  text(text) {}
  element(element) {}
  end() {}
}
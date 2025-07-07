// worker-rate-manager.js
// Handle Cloudflare Worker timeouts and rate limits
import { HtmlTemplates } from '../templates/html-templates.js';

export class WorkerRateManager {
  constructor(options = {}) {
    this.maxExecutionTime = options.maxExecutionTime || 50000; // 50s (CF limit is 60s)
    this.chunkSize = options.chunkSize || 20; // URLs per chunk
    this.pauseBetweenChunks = options.pauseBetweenChunks || 1000;
    this.maxConcurrentRequests = options.maxConcurrentRequests || 5;
  }

  /**
   * Process large URL lists in chunks to avoid CF timeouts
   * @param {Array} urls - Array of URLs to process
   * @param {Function} processorFunction - Function to process each chunk
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results with continuation token
   */
  async processInChunks(urls, processorFunction, options = {}) {
    const startTime = Date.now();
    const { continueFrom = 0, saveProgressCallback } = options;

    const results = [];
    let processedCount = continueFrom;
    let shouldContinue = true;

    // Resume from where we left off
    const remainingUrls = urls.slice(continueFrom);

    for (let i = 0; i < remainingUrls.length && shouldContinue; i += this.chunkSize) {
      // Check if we're approaching timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > this.maxExecutionTime) {
        console.log(`Approaching timeout, stopping at ${processedCount + i} of ${urls.length}`);
        shouldContinue = false;
        break;
      }

      const chunk = remainingUrls.slice(i, i + this.chunkSize);
      console.log(`Processing chunk ${Math.floor(i / this.chunkSize) + 1}, URLs ${processedCount + i + 1}-${processedCount + i + chunk.length}`);

      try {
        // Process chunk with timeout protection
        const chunkResults = await Promise.race([
          processorFunction(chunk),
          this.timeoutPromise(10000) // 10s timeout per chunk
        ]);

        results.push(...chunkResults);
        processedCount += chunk.length;

        // Save progress periodically
        if (saveProgressCallback && (processedCount % 50 === 0)) {
          await saveProgressCallback({
            processed: processedCount,
            total: urls.length,
            results: results.slice(-chunk.length) // Only save recent results
          });
        }

        // Pause between chunks to avoid rate limits
        if (i + this.chunkSize < remainingUrls.length) {
          await this.delay(this.pauseBetweenChunks);
        }

      } catch (error) {
        console.error(`Chunk processing error at ${processedCount + i}:`, error);

        // Add failed results for this chunk
        chunk.forEach((item, index) => {
          results.push({
            url: item.url || `unknown_${processedCount + i + index}`,
            status: 'failed',
            summary: 'Chunk processing failed',
            error: error.message,
            confidence: 0,
            brandMatch: false,
            offerMatch: false,
            termsMatch: false
          });
        });

        processedCount += chunk.length;
      }
    }

    const completed = processedCount >= urls.length;
    const nextContinueFrom = completed ? 0 : processedCount;

    return {
      results,
      completed,
      processed: processedCount,
      total: urls.length,
      continueFrom: nextContinueFrom,
      executionTime: Date.now() - startTime,
      needsContinuation: !completed
    };
  }

  /**
   * Handle continuation requests for large jobs
   * @param {Request} request - Cloudflare Worker request
   * @param {Function} processingFunction - Main processing function
   * @returns {Promise<Response>} Response with results or continuation token
   */
  async handleContinuationRequest(request, processingFunction) {
    const url = new URL(request.url);
    const continueFrom = parseInt(url.searchParams.get('continue_from') || '0');
    const jobId = url.searchParams.get('job_id') || this.generateJobId();

    try {
      const result = await processingFunction({ continueFrom, jobId });

      if (result.needsContinuation) {
        // HTML auto-progression response
        const continuationUrl = `${url.origin}${url.pathname}?job_id=${jobId}&continue_from=${result.continueFrom}`;
        const delaySeconds = 3;

        const html = HtmlTemplates.getBatchProgressPage({
          processed: result.processed,
          total: result.total,
          currentBatch: Math.ceil(result.processed / 20),
          totalBatches: Math.ceil(result.total / 20),
          continuationUrl,
          delaySeconds,
          results: result.results
        });

        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } else {
        // Keep the existing completion response
        return new Response(JSON.stringify({
          success: true,
          completed: true,
          jobId,
          processed: result.processed,
          total: result.total,
          results: result.results,
          executionTime: result.executionTime,
          message: `Successfully processed all ${result.total} URLs.`
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        jobId,
        continueFrom
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Rate limit URLs to avoid overwhelming external services
   * @param {Array} urls - URLs to fetch
   * @param {Function} fetchFunction - Function to fetch each URL
   * @returns {Promise<Array>} Fetched results
   */
  async rateLimitedFetch(urls, fetchFunction) {
    const results = [];
    const semaphore = new Semaphore(this.maxConcurrentRequests);

    const promises = urls.map(async (url) => {
      await semaphore.acquire();
      try {
        const result = await fetchFunction(url);
        results.push(result);
        return result;
      } catch (error) {
        const failedResult = {
          url: url.url || url,
          error: error.message,
          status: 'failed'
        };
        results.push(failedResult);
        return failedResult;
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Smart batching based on verification mode
   * @param {Array} htmlDataArray - HTML data to process
   * @param {Object} config - Processing configuration
   * @param {Function} verificationFunction - Verification function
   * @returns {Promise<Array>} Verification results
   */
  async smartBatch(htmlDataArray, config, verificationFunction) {
    const { verificationMode, batchSize = 5, delayMs = 500 } = config;

    // Adjust batching strategy based on mode
    let effectiveBatchSize = batchSize;
    let effectiveDelay = delayMs;

    if (verificationMode === 'regex') {
      // Regex can handle larger batches
      effectiveBatchSize = Math.min(50, htmlDataArray.length);
      effectiveDelay = 0;
    } else if (verificationMode === 'hybrid') {
      // Hybrid needs medium batches
      effectiveBatchSize = Math.min(15, batchSize);
      effectiveDelay = delayMs / 2;
    }

    const results = [];

    for (let i = 0; i < htmlDataArray.length; i += effectiveBatchSize) {
      const batch = htmlDataArray.slice(i, i + effectiveBatchSize);

      try {
        const batchResults = await verificationFunction(batch);
        results.push(...batchResults);

        if (effectiveDelay > 0 && i + effectiveBatchSize < htmlDataArray.length) {
          await this.delay(effectiveDelay);
        }

      } catch (error) {
        console.error(`Smart batch error at index ${i}:`, error);
        // Add failed results for this batch
        batch.forEach(item => {
          results.push({
            url: item.url,
            status: 'failed',
            summary: 'Batch verification failed',
            error: error.message,
            confidence: 0,
            brandMatch: false,
            offerMatch: false,
            termsMatch: false
          });
        });
      }
    }

    return results;
  }

  /**
   * Progress tracking for long-running jobs
   * @param {string} jobId - Unique job identifier
   * @param {Object} progress - Progress data
   * @param {Object} env - Cloudflare environment (for KV storage)
   */
  async saveProgress(jobId, progress, env) {
    if (env.VERIFICATION_PROGRESS) {
      try {
        await env.VERIFICATION_PROGRESS.put(jobId, JSON.stringify({
          ...progress,
          timestamp: Date.now()
        }), { expirationTtl: 3600 }); // 1 hour expiration
      } catch (error) {
        console.error('Failed to save progress:', error);
      }
    }
  }

  /**
   * Load progress for continuation
   * @param {string} jobId - Job identifier
   * @param {Object} env - Cloudflare environment
   * @returns {Promise<Object|null>} Saved progress or null
   */
  async loadProgress(jobId, env) {
    if (env.VERIFICATION_PROGRESS) {
      try {
        const progressData = await env.VERIFICATION_PROGRESS.get(jobId);
        return progressData ? JSON.parse(progressData) : null;
      } catch (error) {
        console.error('Failed to load progress:', error);
        return null;
      }
    }
    return null;
  }

  /**
   * Utility methods
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  timeoutPromise(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Operation timeout')), ms)
    );
  }

  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  constructor(permits) {
    this.permits = permits;
    this.promiseResolverQueue = [];
  }

  async acquire() {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.promiseResolverQueue.push(resolve);
    });
  }

  release() {
    this.permits++;
    if (this.promiseResolverQueue.length > 0) {
      const resolve = this.promiseResolverQueue.shift();
      this.permits--;
      resolve();
    }
  }
}

/**
 * Usage example in main worker:
 * 
 * import { WorkerRateManager } from './worker-rate-manager.js';
 * 
 * export default {
 *   async fetch(request, env) {
 *     const rateManager = new WorkerRateManager({
 *       chunkSize: 20,
 *       maxExecutionTime: 50000
 *     });
 *     
 *     return rateManager.handleContinuationRequest(request, async ({ continueFrom, jobId }) => {
 *       // Your processing logic here
 *       const urls = await fetchUrlsFromSheet();
 *       
 *       return rateManager.processInChunks(
 *         urls,
 *         async (chunk) => await verifyUrlChunk(chunk),
 *         { 
 *           continueFrom,
 *           saveProgressCallback: (progress) => rateManager.saveProgress(jobId, progress, env)
 *         }
 *       );
 *     });
 *   }
 * };
 */
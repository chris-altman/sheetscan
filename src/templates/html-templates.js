// html-templates.js
// HTML templates for the verification interface

export class HtmlTemplates {
  /**
   * Main verification form
   * @returns {string} HTML for the main form
   */
  static getMainForm() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sheets Verifier</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 {
      color: #2563eb;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 10px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: 600;
      color: #374151;
    }
    input[type="url"], textarea {
      width: 100%;
      padding: 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
    }
    input[type="url"]:focus, textarea:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    textarea {
      resize: vertical;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }
    button {
      background: #2563eb;
      color: white;
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    button:hover {
      background: #1d4ed8;
    }
    button:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    .note {
      background: #f3f4f6;
      padding: 15px;
      border-radius: 6px;
      border-left: 4px solid #6b7280;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .warning {
      background: #fef3c7;
      border-left-color: #f59e0b;
      color: #92400e;
    }
    .verification-modes {
      margin-bottom: 20px;
    }
    .mode-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
      margin: 15px 0;
    }
    .mode-option {
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 15px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .mode-option:hover {
      border-color: #2563eb;
    }
    .mode-option.selected {
      border-color: #2563eb;
      background: #f0f9ff;
    }
    .mode-option input[type="radio"] {
      margin-right: 8px;
    }
    .mode-title {
      font-weight: 600;
      margin-bottom: 5px;
    }
    .mode-description {
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <h1>📊 Sheets Verifier</h1>
  
  <div class="note">
    <strong>What this does:</strong> Compares offers in your source sheet against website content to verify accuracy.
    Make sure both sheets are shared with your service account.
  </div>

  <form method="POST" action="/verify" accept-charset="UTF-8">
    <div class="verification-modes">
      <label class="mode-title">Verification Method:</label>
      
      <div class="mode-grid">
        <div class="mode-option selected">
          <input type="radio" name="verificationMode" value="regex" checked>
          <div class="mode-title">Pattern Matching (FREE)</div>
          <div class="mode-description">Fast regex-based verification. 0 tokens used. Good for obvious matches and mismatches.</div>
        </div>
        
        <div class="mode-option">
          <input type="radio" name="verificationMode" value="hybrid">
          <div class="mode-title">Smart Hybrid (Low Cost)</div>
          <div class="mode-description">Regex first, AI only when uncertain. Cost-effective balance of speed and accuracy.</div>
        </div>
        
        <div class="mode-option">
          <input type="radio" name="verificationMode" value="llm">
          <div class="mode-title">Full LLM (High Cost)</div>
          <div class="mode-description">Complete AI analysis with detailed explanations. Most accurate but uses tokens.</div>
        </div>
      </div>
    </div>

    <div class="form-group">
      <label for="sourceSheetUrl">Source Sheet URL (contains offers/brands):</label>
      <input 
        name="sourceSheetUrl" 
        id="sourceSheetUrl" 
        type="url" 
        required 
        placeholder="https://docs.google.com/spreadsheets/d/..."
      />
    </div>
    
    <div class="form-group">
      <label for="verifierSheetUrl">Verifier Sheet URL (contains URLs to check):</label>
      <input 
        name="verifierSheetUrl" 
        id="verifierSheetUrl" 
        type="url" 
        required 
        placeholder="https://docs.google.com/spreadsheets/d/..."
      />
    </div>
    
    <button type="submit">🚀 Start Verification</button>
  </form>

  <script>
    // Handle mode selection
    const modeOptions = document.querySelectorAll('.mode-option');
    const radioButtons = document.querySelectorAll('input[name="verificationMode"]');
    
    modeOptions.forEach((option, index) => {
      option.addEventListener('click', () => {
        modeOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        radioButtons[index].checked = true;
      });
    });

    // Form validation
    const form = document.querySelector('form');
    const button = document.querySelector('button[type="submit"]');
    
    form.addEventListener('submit', function(e) {
      button.disabled = true;
      button.textContent = '⏳ Starting verification...';
    });
  </script>
</body>
</html>`;
  }

  /**
   * Success results page
   * @param {Object} results - Verification results
   * @param {number} processedCount - Number of URLs processed
   * @param {number} totalCount - Total number of URLs
   * @returns {string} HTML for results page
   */
  static getResultsPage(results, processedCount, totalCount) {
    const successCount = results.filter(r => r.status === 'verified').length;
    const failCount = results.filter(r => r.status === 'failed').length;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Results</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1000px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    .summary {
      background: #f0f9ff;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #0ea5e9;
      margin-bottom: 30px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat {
      background: white;
      padding: 15px;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
      text-align: center;
    }
    .stat-number {
      font-size: 2em;
      font-weight: bold;
      color: #2563eb;
    }
    .success { color: #059669; }
    .failed { color: #dc2626; }
    .processing { color: #d97706; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
    }
    .status {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status.verified {
      background: #d1fae5;
      color: #065f46;
    }
    .status.failed {
      background: #fee2e2;
      color: #991b1b;
    }
    .status.processing {
      background: #fef3c7;
      color: #92400e;
    }
    .back-button {
      display: inline-block;
      background: #6b7280;
      color: white;
      padding: 10px 20px;
      text-decoration: none;
      border-radius: 6px;
      margin-bottom: 20px;
    }
    .back-button:hover {
      background: #4b5563;
    }
  </style>
</head>
<body>
  <a href="/" class="back-button">← Back to Verifier</a>
  
  <h1>✅ Verification Complete</h1>
  
  <div class="summary">
    <div class="stats">
      <div class="stat">
        <div class="stat-number">${totalCount}</div>
        <div>Total URLs</div>
      </div>
      <div class="stat">
        <div class="stat-number processing">${processedCount}</div>
        <div>Processed</div>
      </div>
      <div class="stat">
        <div class="stat-number success">${successCount}</div>
        <div>Verified</div>
      </div>
      <div class="stat">
        <div class="stat-number failed">${failCount}</div>
        <div>Failed</div>
      </div>
    </div>
  </div>

  <h2>Detailed Results</h2>
  <table>
    <thead>
      <tr>
        <th>Row</th>
        <th>URL</th>
        <th>Status</th>
        <th>Verification</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${results.map(result => `
        <tr>
          <td>${result.rowIndex}</td>
          <td><a href="${result.url}" target="_blank">${result.url}</a></td>
          <td><span class="status ${result.status}">${result.status}</span></td>
          <td>${result.verification || '-'}</td>
          <td style="white-space: pre-line;">${result.notes || '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;
  }

  /**
   * Error page template
   * @param {string} error - Error message
   * @param {string} [details] - Additional error details
   * @returns {string} HTML for error page
   */
  static getErrorPage(error, details = null) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    .error {
      background: #fee2e2;
      border: 1px solid #fca5a5;
      color: #991b1b;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .error h2 {
      margin-top: 0;
      color: #dc2626;
    }
    .details {
      background: #f9fafb;
      padding: 15px;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 14px;
      overflow-x: auto;
    }
    .back-button {
      display: inline-block;
      background: #6b7280;
      color: white;
      padding: 10px 20px;
      text-decoration: none;
      border-radius: 6px;
    }
    .back-button:hover {
      background: #4b5563;
    }
  </style>
</head>
<body>
  <div class="error">
    <h2>❌ Verification Failed</h2>
    <p><strong>Error:</strong> ${error}</p>
    ${details ? `
      <h3>Details:</h3>
      <div class="details">${details}</div>
    ` : ''}
  </div>
  
  <a href="/" class="back-button">← Back to Verifier</a>
</body>
</html>`;
  }

  /**
   * Progress/status page for long-running operations
   * @param {string} message - Status message
   * @param {number} [progress] - Progress percentage (0-100)
   * @returns {string} HTML for status page
   */
  static getStatusPage(message, progress = null) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Processing...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 40px auto;
      padding: 20px;
      text-align: center;
      line-height: 1.6;
      color: #333;
    }
    .spinner {
      border: 4px solid #e5e7eb;
      border-top: 4px solid #2563eb;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .progress-bar {
      width: 100%;
      height: 20px;
      background: #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
      margin: 20px 0;
    }
    .progress-fill {
      height: 100%;
      background: #2563eb;
      transition: width 0.3s ease;
    }
  </style>
</head>
<body>
  <h1>🔄 Processing Verification</h1>
  <div class="spinner"></div>
  <p>${message}</p>
  ${progress !== null ? `
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${progress}%"></div>
    </div>
    <p>${progress}% complete</p>
  ` : ''}
  <p><em>This may take several minutes depending on the number of URLs...</em></p>
</body>
</html>`;
  }

  /**
   * Batch progress page with auto-timer
   * @param {Object} options - Progress options
   * @returns {string} HTML for batch progress page
   */
  static getBatchProgressPage(options) {
    const { processed, total, currentBatch, totalBatches, continuationUrl, delaySeconds, results } = options;
    const percentage = Math.round((processed / total) * 100);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Processing Batch ${currentBatch} of ${totalBatches}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 40px auto;
      padding: 20px;
      text-align: center;
      line-height: 1.6;
      color: #333;
    }
    .progress-bar {
      width: 100%;
      height: 20px;
      background: #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
      margin: 20px 0;
    }
    .progress-fill {
      height: 100%;
      background: #2563eb;
      width: ${percentage}%;
      transition: width 0.3s ease;
    }
    .countdown {
      font-size: 2em;
      color: #2563eb;
      margin: 20px 0;
      font-weight: bold;
    }
    .cancel-btn {
      background: #dc2626;
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      margin-top: 20px;
    }
    .cancel-btn:hover {
      background: #b91c1c;
    }
    .batch-info {
      background: #f0f9ff;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #0ea5e9;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <h1>🔄 Processing Batch ${currentBatch} of ${totalBatches}</h1>
  
  <div class="batch-info">
    <p><strong>Progress:</strong> ${processed}/${total} URLs complete (${percentage}%)</p>
    <div class="progress-bar"><div class="progress-fill"></div></div>
  </div>
  
  <div class="countdown" id="countdown">${delaySeconds}</div>
  <p>Next batch starting in <span id="timer">${delaySeconds}</span> seconds...</p>
  
  <button class="cancel-btn" onclick="window.location.href='/'">Cancel Processing</button>
  
  <script>
    let timeLeft = ${delaySeconds};
    const countdown = document.getElementById('countdown');
    const timer = document.getElementById('timer');
    
    const interval = setInterval(() => {
      timeLeft--;
      countdown.textContent = timeLeft;
      timer.textContent = timeLeft;
      
      if (timeLeft <= 0) {
        clearInterval(interval);
        countdown.textContent = 'Starting...';
        window.location.href = '${continuationUrl}';
      }
    }, 1000);
  </script>
</body>
</html>`;
  }
}
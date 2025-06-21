// auth-service.js
// Handles Google API authentication using service account credentials

export class AuthService {
  constructor(serviceAccountKey) {
    this.serviceAccountKey = serviceAccountKey;
  }

  /**
   * Creates AuthService from environment variables
   * @param {Object} env - Cloudflare Worker environment variables
   * @returns {AuthService}
   */
  static fromEnv(env) {
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is required');
    }
    
    const serviceAccountKey = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return new AuthService(serviceAccountKey);
  }

  /**
   * Generates JWT for Google API authentication
   * @returns {Promise<string>} JWT token
   */
  async generateJWT() {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.serviceAccountKey.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      this.pemToArrayBuffer(this.serviceAccountKey.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      new TextEncoder().encode(unsignedToken)
    );

    const encodedSignature = this.base64UrlEncode(new Uint8Array(signature));
    return `${unsignedToken}.${encodedSignature}`;
  }

  /**
   * Gets Google API access token
   * @returns {Promise<string>} Access token
   */
  async getAccessToken() {
    const jwt = await this.generateJWT();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get access token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  /**
   * Encodes data to base64url format
   * @param {string|Uint8Array} data - Data to encode
   * @returns {string} Base64url encoded string
   */
  base64UrlEncode(data) {
    let base64;
    
    if (typeof data === 'string') {
      const bytes = new TextEncoder().encode(data);
      base64 = btoa(String.fromCharCode(...bytes));
    } else if (data instanceof Uint8Array) {
      base64 = btoa(String.fromCharCode(...data));
    } else {
      throw new Error('Unsupported data type for base64UrlEncode');
    }
    
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Converts PEM private key to ArrayBuffer
   * @param {string} pem - PEM formatted private key
   * @returns {ArrayBuffer} Private key as ArrayBuffer
   */
  pemToArrayBuffer(pem) {
    const pemHeader = '-----BEGIN PRIVATE KEY-----';
    const pemFooter = '-----END PRIVATE KEY-----';
    const pemContents = pem.replace(pemHeader, '').replace(pemFooter, '').replace(/\s/g, '');
    const binaryString = atob(pemContents);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
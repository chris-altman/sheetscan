// regex-verifier.js
// Fast pattern-based verification without LLM calls

export class RegexVerifier {
  constructor() {
    // Pre-compiled regex patterns for performance
    this.brandPatterns = this.compileBrandPatterns();
    this.offerPatterns = this.compileOfferPatterns();
    this.amountPatterns = this.compileAmountPatterns();
    this.statePatterns = this.compileStatePatterns();
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return null;
    }
  }

  /**
   * FIXED: Main verification method with smart selective matching
   * @param {Object} htmlData - Parsed HTML data
   * @param {Array} sourceOffers - Source sheet offers  
   * @param {string} url - URL being verified
   * @returns {Object} Verification result (same format as LLM)
   */
  verifyOfferAccuracy(htmlData, sourceOffers, url) {
    const startTime = Date.now();
    
    // Extract all text content
    const allText = this.extractAllText(htmlData);
    
    // STEP 1: Detect what's actually on the page
    const detectedContent = {
      brands: this.detectBrands(allText),
      offers: this.detectOffers(allText),
      amounts: this.detectAmounts(allText),
      states: this.detectStates(allText),
      domain: this.extractDomain(url),
      fullText: allText
    };
    
    // STEP 2: Find only the relevant source offers (KEY FIX!)
    const relevantOffers = this.findRelevantOffers(detectedContent, sourceOffers);
    
    console.log(`URL: ${url}`);
    console.log(`Total source offers: ${sourceOffers.length}`);
    console.log(`Relevant offers found: ${relevantOffers.length}`);
    console.log(`Relevant brands: ${relevantOffers.map(o => o.brand).join(', ')}`);
    
    // STEP 3: If no relevant offers, that's fine! (Not a failure)
    if (relevantOffers.length === 0) {
      return {
        status: 'no_relevant_offers',
        summary: 'No relevant offers detected (page may be out of scope)',
        details: `Detected brands: ${detectedContent.brands.join(', ') || 'none'} | Source brands: ${sourceOffers.map(o => o.brand).slice(0, 3).join(', ')}...`,
        confidence: 90, // High confidence that we correctly determined irrelevance
        brandMatch: false,
        offerMatch: false,
        termsMatch: true, // Not penalizing for irrelevant content
        foundBrands: detectedContent.brands,
        foundOffers: detectedContent.offers.slice(0, 2),
        provider: 'regex',
        processingTimeMs: Date.now() - startTime,
        tokensUsed: 0,
        relevantOffersCount: 0,
        totalSourceOffers: sourceOffers.length
      };
    }
    
    // STEP 4: Only verify the relevant offers
    const verification = this.verifyRelevantOffers(detectedContent, relevantOffers);
    
    const processingTime = Date.now() - startTime;
    
    return {
      ...verification,
      url,
      provider: 'regex',
      processingTimeMs: processingTime,
      tokensUsed: 0,
      costEstimate: '$0.00',
      relevantOffersCount: relevantOffers.length,
      totalSourceOffers: sourceOffers.length,
      skippedOffers: sourceOffers.length - relevantOffers.length
    };
  }

  /**
   * NEW: Find source offers that are actually relevant to this webpage
   */
  findRelevantOffers(detectedContent, allSourceOffers) {
    const relevantOffers = [];
    
    for (const sourceOffer of allSourceOffers) {
      if (this.isOfferRelevantToPage(sourceOffer, detectedContent)) {
        relevantOffers.push(sourceOffer);
      }
    }
    
    return relevantOffers;
  }

  /**
   * NEW: Determine if a source offer is relevant to the current webpage
   */
  isOfferRelevantToPage(sourceOffer, detectedContent) {
    const { brands, fullText, domain } = detectedContent;
    
    // 1. Check if the brand is mentioned on the page
    if (sourceOffer.brand) {
      const brandLower = sourceOffer.brand.toLowerCase().replace(/\s+/g, '');
      
      // Direct brand name match
      if (brands.some(brand => 
        brand.includes(brandLower) || 
        brandLower.includes(brand)
      )) {
        return true;
      }
      
      // Brand mentioned in text
      if (fullText.includes(sourceOffer.brand.toLowerCase())) {
        return true;
      }
      
      // Domain-based matching (e.g., betmgm.com should check BetMGM offers)
      if (domain && domain.includes(brandLower)) {
        return true;
      }
    }
    
    // 2. Check if offer keywords are mentioned (for generic offers)
    if (sourceOffer.offer) {
      const offerKeywords = sourceOffer.offer.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 4) // Only meaningful words
        .filter(word => !['with', 'from', 'when', 'your', 'this', 'that'].includes(word));
      
      if (offerKeywords.length > 0) {
        const matchingKeywords = offerKeywords.filter(keyword => 
          fullText.includes(keyword)
        );
        
        // If 30%+ of significant keywords match, consider it relevant
        if (matchingKeywords.length >= Math.max(1, offerKeywords.length * 0.3)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * NEW: Verify only the relevant offers (not all source offers)
   */
  verifyRelevantOffers(detectedContent, relevantOffers) {
    let totalScore = 0;
    let maxScore = 0;
    const verificationDetails = [];
    
    for (const offer of relevantOffers) {
      const offerVerification = this.verifyIndividualOffer(offer, detectedContent);
      totalScore += offerVerification.score;
      maxScore += offerVerification.maxScore;
      verificationDetails.push(offerVerification);
    }
    
    const confidence = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    
    // Determine overall status based on RELEVANT offers only
    let status = 'failed';
    if (confidence >= 75) status = 'verified';
    else if (confidence >= 50) status = 'partial';
    
    return {
      status,
      summary: this.generateSmartSummary(verificationDetails, relevantOffers.length),
      details: this.generateSmartDetails(verificationDetails),
      confidence,
      brandMatch: verificationDetails.some(v => v.brandFound),
      offerMatch: verificationDetails.some(v => v.offerFound),
      termsMatch: verificationDetails.some(v => v.termsFound),
      foundBrands: [...new Set(verificationDetails.filter(v => v.brandFound).map(v => v.brand))],
      foundOffers: verificationDetails.filter(v => v.offerFound).map(v => v.offerText),
      discrepancies: verificationDetails.filter(v => v.discrepancies.length > 0)
        .flatMap(v => v.discrepancies)
    };
  }

  /**
   * NEW: Verify a single offer against detected content
   */
  verifyIndividualOffer(offer, detectedContent) {
    const verification = {
      brand: offer.brand,
      offerText: offer.offer,
      brandFound: false,
      offerFound: false,
      termsFound: false,
      score: 0,
      maxScore: 3,
      discrepancies: []
    };

    // Check brand presence
    if (offer.brand) {
      const brandLower = offer.brand.toLowerCase();
      if (detectedContent.brands.some(brand => 
        brand.includes(brandLower) || brandLower.includes(brand)
      ) || detectedContent.fullText.includes(brandLower)) {
        verification.brandFound = true;
        verification.score += 1;
      } else {
        verification.discrepancies.push(`Brand "${offer.brand}" not clearly mentioned`);
      }
    } else {
      verification.score += 1; // No brand to check
    }

    // Check offer details
    if (offer.offer) {
      const offerKeywords = offer.offer.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3);
      
      const matchingKeywords = offerKeywords.filter(keyword => 
        detectedContent.fullText.includes(keyword)
      );
      
      if (matchingKeywords.length >= Math.max(1, offerKeywords.length * 0.4)) {
        verification.offerFound = true;
        verification.score += 1;
      } else {
        verification.discrepancies.push(`Offer details unclear or missing`);
      }
    } else {
      verification.score += 1; // No offer to check
    }

    // Check terms (if specified)
    if (offer.keyTandC && offer.keyTandC.trim()) {
      const termsKeywords = offer.keyTandC.toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3);
      
      if (termsKeywords.some(keyword => detectedContent.fullText.includes(keyword))) {
        verification.termsFound = true;
        verification.score += 1;
      } else {
        verification.discrepancies.push(`Key terms not mentioned`);
      }
    } else {
      verification.termsFound = true;
      verification.score += 1; // No terms to check
    }

    return verification;
  }

  /**
   * Generate summary explaining what was actually verified
   */
  generateSmartSummary(verificationDetails, totalRelevant) {
    const successful = verificationDetails.filter(v => v.score >= v.maxScore * 0.7);
    
    if (totalRelevant === 0) {
      return 'No relevant offers to verify';
    } else if (successful.length === 0) {
      return `Found ${totalRelevant} relevant offer(s) but accuracy verification failed`;
    } else if (successful.length === totalRelevant) {
      return `Successfully verified ${successful.length} relevant offer(s)`;
    } else {
      return `Verified ${successful.length}/${totalRelevant} relevant offers`;
    }
  }

  /**
   * Generate detailed breakdown
   */
  generateSmartDetails(verificationDetails) {
    const details = [];
    
    verificationDetails.forEach(v => {
      const score = `${v.score}/${v.maxScore}`;
      const status = v.score >= v.maxScore * 0.7 ? '✓' : '✗';
      details.push(`${status} ${v.brand}: ${score}`);
    });
    
    return details.join(' | ');
  }

  /**
   * Extract and normalize all text content
   */
  extractAllText(htmlData) {
    const { h1, metaTitle, metaDescription, mainContent } = htmlData;
    
    return [h1, metaTitle, metaDescription, mainContent]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9\s$%]/g, ' ') // Normalize special chars
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Compile brand detection patterns
   */
  compileBrandPatterns() {
    return {
      betmgm: /bet\s*mgm|betmgm/gi,
      caesars: /caesars?|caesar['']?s/gi,
      draftkings: /draft\s*kings?|draftkings?/gi,
      fanduel: /fan\s*duel|fanduel/gi,
      bet365: /bet\s*365|bet365/gi,
      barstool: /bar\s*stool|barstool/gi,
      pointsbet: /points?\s*bet|pointsbet/gi,
      unibet: /uni\s*bet|unibet/gi,
      williamhill: /william\s*hill/gi,
      betrivers: /bet\s*rivers?|betrivers?/gi,
      borgata: /borgata/gi,
      golden_nugget: /golden\s*nugget/gi,
      hard_rock: /hard\s*rock/gi,
      penn: /penn\s*(bet|sportsbook)/gi,
      espnbet: /espn\s*bet|espnbet/gi
    };
  }

  /**
   * Compile offer detection patterns
   */
  compileOfferPatterns() {
    return {
      welcome_bonus: /(welcome|sign\s*up|new\s*(user|customer|player)).{0,30}(bonus|offer|bet)/gi,
      deposit_match: /(deposit|first\s*deposit).{0,20}(match|bonus)/gi,
      free_bet: /(free|risk\s*free).{0,15}bet/gi,
      first_bet: /(first|1st).{0,20}bet.{0,20}(insurance|protected?|back|refund)/gi,
      cashback: /(cash\s*back|money\s*back)/gi,
      percentage_bonus: /(\d+\s*%).{0,15}(bonus|match|up\s*to)/gi,
      parlay_insurance: /(parlay|sgp).{0,20}(insurance|boost)/gi,
      odds_boost: /(odds?\s*boost|enhanced\s*odds?)/gi,
      profit_boost: /(profit\s*boost|winnings\s*boost)/gi
    };
  }

  /**
   * Compile amount detection patterns
   */
  compileAmountPatterns() {
    return {
      dollar_amounts: /\$\s*(\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,
      percentage: /(\d{1,3})\s*%/g,
      up_to_amounts: /up\s*to\s*\$\s*(\d{1,4}(?:,\d{3})*)/gi,
      max_amounts: /max(?:imum)?\s*\$\s*(\d{1,4}(?:,\d{3})*)/gi
    };
  }

  /**
   * Compile state detection patterns
   */
  compileStatePatterns() {
    const states = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 
                   'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 
                   'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 
                   'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 
                   'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
    
    return new RegExp(`\\b(${states.join('|')})\\b`, 'gi');
  }

  /**
   * Detect brands in content
   */
  detectBrands(text) {
    const detected = [];
    
    Object.entries(this.brandPatterns).forEach(([brand, pattern]) => {
      if (pattern.test(text)) {
        detected.push(brand);
        pattern.lastIndex = 0; // Reset regex state
      }
    });
    
    return detected;
  }

  /**
   * Detect offer types in content
   */
  detectOffers(text) {
    const detected = [];
    
    Object.entries(this.offerPatterns).forEach(([offerType, pattern]) => {
      const matches = text.match(pattern);
      if (matches) {
        detected.push({
          type: offerType,
          matches: matches.slice(0, 3), // Limit to 3 matches
          count: matches.length
        });
      }
    });
    
    return detected;
  }

  /**
   * Detect monetary amounts
   */
  detectAmounts(text) {
    const amounts = [];
    
    Object.entries(this.amountPatterns).forEach(([type, pattern]) => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        amounts.push({
          type,
          value: match[1] || match[0],
          context: text.substring(Math.max(0, match.index - 20), match.index + 30)
        });
      });
    });
    
    return amounts.slice(0, 10); // Limit to 10 amounts
  }

  /**
   * Detect state references
   */
  detectStates(text) {
    const matches = text.match(this.statePatterns) || [];
    return [...new Set(matches.map(s => s.toUpperCase()))];
  }

  /**
   * Analyze source offers for comparison
   */
  analyzeSourceOffers(sourceOffers) {
    const analysis = {
      expectedBrands: [],
      expectedOfferTypes: [],
      expectedAmounts: [],
      expectedStates: []
    };

    sourceOffers.forEach(offer => {
      // Extract brand
      if (offer.brand) {
        analysis.expectedBrands.push(offer.brand.toLowerCase());
      }

      // Categorize offer type
      const offerText = (offer.offer || '').toLowerCase();
      if (offerText.includes('welcome') || offerText.includes('sign up')) {
        analysis.expectedOfferTypes.push('welcome_bonus');
      }
      if (offerText.includes('deposit')) {
        analysis.expectedOfferTypes.push('deposit_match');
      }
      if (offerText.includes('free bet')) {
        analysis.expectedOfferTypes.push('free_bet');
      }
      if (offerText.includes('first bet')) {
        analysis.expectedOfferTypes.push('first_bet');
      }

      // Extract amounts from offers
      const amounts = (offer.offer || '').match(/\$(\d{1,4}(?:,\d{3})*)/g);
      if (amounts) {
        analysis.expectedAmounts.push(...amounts);
      }

      // Extract states
      if (offer.states) {
        const states = offer.states.split(',').map(s => s.trim().toUpperCase());
        analysis.expectedStates.push(...states);
      }
    });

    // Remove duplicates
    analysis.expectedBrands = [...new Set(analysis.expectedBrands)];
    analysis.expectedOfferTypes = [...new Set(analysis.expectedOfferTypes)];
    analysis.expectedAmounts = [...new Set(analysis.expectedAmounts)];
    analysis.expectedStates = [...new Set(analysis.expectedStates)];

    return analysis;
  }

  /**
   * Perform verification logic
   */
  performVerification(detected, expected, fullText) {
    // Brand matching
    const brandMatches = detected.detectedBrands.filter(brand => 
      expected.expectedBrands.some(expectedBrand => 
        expectedBrand.includes(brand) || brand.includes(expectedBrand)
      )
    );

    // Offer type matching
    const offerMatches = detected.detectedOffers.filter(offer => 
      expected.expectedOfferTypes.includes(offer.type)
    );

    // Amount validation
    const amountMatches = detected.detectedAmounts.filter(amount => 
      expected.expectedAmounts.some(expectedAmount => 
        expectedAmount.includes(amount.value) || amount.value.includes(expectedAmount.replace('$', ''))
      )
    );

    // State validation
    const stateMatches = detected.detectedStates.filter(state => 
      expected.expectedStates.includes(state)
    );

    // Calculate confidence and status
    const brandMatch = brandMatches.length > 0;
    const offerMatch = offerMatches.length > 0;
    const termsMatch = stateMatches.length > 0 || expected.expectedStates.length === 0;

    let confidence = 0;
    let status = 'failed';

    if (brandMatch) confidence += 40;
    if (offerMatch) confidence += 35;
    if (termsMatch) confidence += 25;

    // Adjust confidence based on content quality
    if (fullText.length > 100) confidence += 5;
    if (detected.detectedAmounts.length > 0) confidence += 5;

    if (confidence >= 80) status = 'verified';
    else if (confidence >= 50) status = 'partial';

    return {
      status,
      summary: this.generateSummary(brandMatches, offerMatches, confidence),
      details: this.generateDetails(detected, expected, brandMatches, offerMatches),
      confidence: Math.min(100, confidence),
      brandMatch,
      offerMatch,
      termsMatch,
      foundBrands: brandMatches,
      foundOffers: offerMatches.map(o => o.type),
      discrepancies: this.findDiscrepancies(detected, expected)
    };
  }

  /**
   * Generate human-readable summary
   */
  generateSummary(brandMatches, offerMatches, confidence) {
    if (brandMatches.length === 0) {
      return 'No expected brands detected on webpage';
    }
    
    if (offerMatches.length === 0) {
      return `Found ${brandMatches.join(', ')} but no matching offers detected`;
    }
    
    return `Found ${brandMatches.join(', ')} with ${offerMatches.length} matching offer type(s)`;
  }

  /**
   * Generate detailed explanation
   */
  generateDetails(detected, expected, brandMatches, offerMatches) {
    const details = [];
    
    details.push(`Brands: Expected ${expected.expectedBrands.length}, Found ${brandMatches.length}`);
    details.push(`Offers: Expected ${expected.expectedOfferTypes.length}, Found ${offerMatches.length}`);
    details.push(`States: Expected ${expected.expectedStates.length}, Found ${detected.detectedStates.length}`);
    
    if (detected.detectedAmounts.length > 0) {
      details.push(`Amounts: ${detected.detectedAmounts.slice(0, 3).map(a => a.value).join(', ')}`);
    }
    
    return details.join(' | ');
  }

  /**
   * Find discrepancies between expected and detected
   */
  findDiscrepancies(detected, expected) {
    const discrepancies = [];
    
    // Missing expected brands
    const missingBrands = expected.expectedBrands.filter(brand => 
      !detected.detectedBrands.some(detected => detected.includes(brand) || brand.includes(detected))
    );
    
    if (missingBrands.length > 0) {
      discrepancies.push(`Missing brands: ${missingBrands.join(', ')}`);
    }
    
    // Unexpected brands
    const unexpectedBrands = detected.detectedBrands.filter(brand => 
      !expected.expectedBrands.some(expected => expected.includes(brand) || brand.includes(expected))
    );
    
    if (unexpectedBrands.length > 0) {
      discrepancies.push(`Unexpected brands: ${unexpectedBrands.join(', ')}`);
    }
    
    return discrepancies;
  }

  /**
   * Process multiple URLs (same interface as LLM service)
   */
  async verifyMultipleOffers(htmlDataArray, sourceOffers) {
    return htmlDataArray.map(htmlData => 
      this.verifyOfferAccuracy(htmlData, sourceOffers, htmlData.url)
    );
  }

  /**
   * Test method for compatibility
   */
  async testConnection() {
    return true; // Regex patterns always work
  }

  /**
   * Get provider info
   */
  getProviderInfo() {
    return {
      provider: 'regex',
      model: 'pattern_matching',
      maxTokens: 0,
      optimization: 'maximum',
      estimatedCostReduction: '100%'
    };
  }
}
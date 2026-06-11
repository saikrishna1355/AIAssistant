class QuestionDetector {
  constructor() {
    this.questionStarters = [
      'what', 'how', 'why', 'when', 'where', 'who', 'which',
      'can you', 'could you', 'would you', 'do you', 'did you',
      'is there', 'are there', 'will you', 'have you',
      'tell me', 'describe', 'explain', 'walk me through',
      'implement', 'write code', 'solve this', 'write a function'
    ];

    this.codingKeywords = [
      'algorithm', 'code', 'implement', 'function', 'array',
      'string', 'tree', 'graph', 'dynamic programming', 'leetcode',
      'binary search', 'linked list', 'hash table', 'recursion',
      'sort', 'reverse', 'palindrome', 'fibonacci', 'factorial',
      'complexity', 'big o', 'heap', 'queue', 'stack', 'sliding window',
      'two pointers', 'dfs', 'bfs', 'merge sort', 'quick sort'
    ];

    this.behavioralKeywords = [
      'tell me about a time', 'describe a situation', 'experience',
      'challenge', 'conflict', 'leadership', 'teamwork', 'failure',
      'strength', 'weakness', 'accomplishment', 'difficult decision',
      'worked with', 'dealt with', 'handled'
    ];

    this.technicalKeywords = [
      'system design', 'architecture', 'database', 'api',
      'microservices', 'scalability', 'performance', 'security',
      'design patterns', 'object oriented', 'framework', 'cache',
      'load balancer', 'distributed', 'rest api', 'graphql'
    ];

    this.recentQuestions = new Map(); // Track recent questions to avoid duplicates
    this.partialTranscript = ''; // Accumulate partial transcripts
    this.questionBuffer = ''; // Buffer for question assembly
    this.lastQuestionTime = 0;
    this.questionCooldown = 3000; // 3 second cooldown between questions
  }

  isQuestion(text, isPartial = false) {
    const lowerText = text.toLowerCase().trim();
    
    // Update partial transcript buffer
    if (isPartial) {
      this.partialTranscript = lowerText;
      return false; // Don't trigger on partial transcripts
    }

    // Combine with any accumulated partial transcript
    const fullText = this.partialTranscript ? `${this.partialTranscript} ${lowerText}` : lowerText;
    this.partialTranscript = ''; // Reset after processing

    // Check for explicit question mark
    if (fullText.includes('?')) {
      return this.isValidQuestion(fullText);
    }

    // Check for question starters at the beginning of sentences
    const sentences = this.splitIntoSentences(fullText);
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (this.startsWithQuestionWord(trimmed)) {
        return this.isValidQuestion(trimmed);
      }
    }

    return false;
  }

  startsWithQuestionWord(sentence) {
    const lowerSentence = sentence.toLowerCase();
    
    // Check if sentence starts with a question word
    return this.questionStarters.some(starter => {
      return lowerSentence.startsWith(starter.toLowerCase() + ' ') ||
             lowerSentence === starter.toLowerCase();
    });
  }

  isValidQuestion(text) {
    // Filter out very short or invalid questions
    if (text.length < 8) return false;
    
    // Check for cooldown period
    const now = Date.now();
    if (now - this.lastQuestionTime < this.questionCooldown) {
      return false;
    }

    // Check for duplicates using similarity
    const questionKey = this.normalizeForDeduplication(text);
    if (this.recentQuestions.has(questionKey)) {
      const lastTime = this.recentQuestions.get(questionKey);
      if (now - lastTime < 30000) { // 30 second window for duplicates
        return false;
      }
    }

    // Mark as processed
    this.recentQuestions.set(questionKey, now);
    this.lastQuestionTime = now;
    
    // Clean old entries
    this.cleanupOldQuestions();
    
    return true;
  }

  splitIntoSentences(text) {
    // Split on sentence boundaries, keeping the text
    return text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  }

  normalizeForDeduplication(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .substring(0, 50); // First 50 chars for comparison
  }

  cleanupOldQuestions() {
    const now = Date.now();
    const cutoff = now - 300000; // 5 minutes
    
    for (const [key, time] of this.recentQuestions.entries()) {
      if (time < cutoff) {
        this.recentQuestions.delete(key);
      }
    }
  }

  categorizeQuestion(text) {
    const lowerText = text.toLowerCase();

    // Check for coding questions
    if (this.codingKeywords.some(keyword => lowerText.includes(keyword))) {
      return 'coding';
    }

    // Check for behavioral questions
    if (this.behavioralKeywords.some(keyword => lowerText.includes(keyword))) {
      return 'behavioral';
    }

    // Check for technical questions
    if (this.technicalKeywords.some(keyword => lowerText.includes(keyword))) {
      return 'technical';
    }

    // Default to general
    return 'general';
  }

  isCodingProblem(text) {
    const lowerText = text.toLowerCase();
    
    const codingProblemIndicators = [
      'given an array', 'write a function', 'implement',
      'algorithm', 'time complexity', 'space complexity',
      'example:', 'input:', 'output:', 'constraints:',
      'leetcode', 'hackerrank', 'codesignal', 'coderpad',
      'return', 'class solution', 'public static', 'def ', 'function '
    ];

    return codingProblemIndicators.some(indicator => 
      lowerText.includes(indicator)
    );
  }

  extractQuestionFromTranscription(transcription, isPartial = false) {
    // For partial transcripts, just return the current state
    if (isPartial) {
      this.questionBuffer = transcription;
      return null; // Don't extract from partial
    }

    // Combine with any buffered partial content
    const fullText = this.questionBuffer ? 
      `${this.questionBuffer} ${transcription}`.trim() : transcription.trim();
    
    this.questionBuffer = ''; // Reset buffer

    // Extract the actual question from the full text
    const sentences = this.splitIntoSentences(fullText);
    
    // Look for the most complete question
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (this.startsWithQuestionWord(trimmed) || trimmed.includes('?')) {
        // Clean up and return the question
        return this.cleanQuestion(trimmed);
      }
    }

    // If no clear question found, return the full text if it seems like a question
    if (this.startsWithQuestionWord(fullText) || fullText.includes('?')) {
      return this.cleanQuestion(fullText);
    }

    return fullText.trim();
  }

  cleanQuestion(question) {
    return question
      .replace(/^(um|uh|so|well|okay)\s+/i, '') // Remove filler words at start
      .replace(/\s+(um|uh|like)\s+/gi, ' ') // Remove filler words in middle
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  processTranscriptSegment(transcript, isPartial = false, metadata = {}) {
    // Process incoming transcript segment
    const result = {
      isQuestion: false,
      question: null,
      type: null,
      confidence: metadata.confidence || 0,
      timestamp: Date.now()
    };

    // Check if this segment contains a question
    if (this.isQuestion(transcript, isPartial)) {
      const extractedQuestion = this.extractQuestionFromTranscription(transcript, isPartial);
      
      if (extractedQuestion) {
        result.isQuestion = true;
        result.question = extractedQuestion;
        result.type = this.categorizeQuestion(extractedQuestion);
        result.urgency = this.getQuestionUrgency(extractedQuestion);
      }
    }

    return result;
  }

  getQuestionUrgency(text) {
    const urgencyKeywords = [
      'urgent', 'immediately', 'right now', 'asap',
      'quick', 'fast', 'hurry'
    ];

    const lowerText = text.toLowerCase();
    return urgencyKeywords.some(keyword => lowerText.includes(keyword));
  }

  resetState() {
    this.partialTranscript = '';
    this.questionBuffer = '';
    this.recentQuestions.clear();
  }
}

module.exports = { QuestionDetector };

class QuestionDetector {
  constructor() {
    this.questionIndicators = [
      '?', 'what', 'how', 'why', 'when', 'where', 'who',
      'tell me', 'describe', 'explain', 'can you',
      'implement', 'write code', 'solve this', 'write a function'
    ];

    this.codingKeywords = [
      'algorithm', 'code', 'implement', 'function', 'array',
      'string', 'tree', 'graph', 'dynamic programming', 'leetcode',
      'binary search', 'linked list', 'hash table', 'recursion',
      'sort', 'reverse', 'palindrome', 'fibonacci', 'factorial',
      'complexity', 'big o', 'heap', 'queue', 'stack', 'sliding window',
      'two pointers', 'dfs', 'bfs'
    ];

    this.behavioralKeywords = [
      'tell me about a time', 'describe a situation', 'experience',
      'challenge', 'conflict', 'leadership', 'teamwork', 'failure',
      'strength', 'weakness', 'accomplishment', 'difficult decision'
    ];

    this.technicalKeywords = [
      'system design', 'architecture', 'database', 'api',
      'microservices', 'scalability', 'performance', 'security',
      'design patterns', 'object oriented', 'framework', 'cache',
      'load balancer', 'distributed'
    ];
  }

  isQuestion(text) {
    const lowerText = text.toLowerCase().trim();
    
    // Check for question mark
    if (lowerText.includes('?')) {
      return true;
    }

    // Check for question indicators
    return this.questionIndicators.some(indicator => lowerText.includes(indicator.toLowerCase()));
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

  extractQuestionFromTranscription(transcription) {
    // Extract the actual question from a longer transcription
    const sentences = transcription.split(/[.!?]+/);
    
    for (const sentence of sentences) {
      if (this.isQuestion(sentence.trim())) {
        return sentence.trim();
      }
    }

    return transcription.trim();
  }

  getQuestionUrgency(text) {
    const urgencyKeywords = [
      'urgent', 'immediately', 'right now', 'asap',
      'quick', 'fast', 'hurry'
    ];

    const lowerText = text.toLowerCase();
    return urgencyKeywords.some(keyword => lowerText.includes(keyword));
  }
}

module.exports = { QuestionDetector };

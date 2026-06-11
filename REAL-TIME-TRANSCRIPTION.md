# Real-Time Speech Processing Enhancement

## Overview

The Interview Copilot AI now features **sophisticated real-time speech processing** using AWS Transcribe Streaming with intelligent question detection and immediate answer generation.

## New Workflow

### 1. Continuous Audio Streaming
- Audio is continuously captured and streamed to AWS Transcribe
- Both partial and final transcripts are processed in real-time
- System supports microphone, system audio, or both sources

### 2. Intelligent Question Detection
- **Enhanced question detection** with sophisticated algorithms
- Detects explicit question marks and interrogative phrases
- Supports natural spoken questions without punctuation
- **Advanced duplicate prevention** with similarity matching
- **Cooldown periods** to prevent rapid-fire duplicates

### 3. Immediate Answer Generation
- Questions trigger **immediate AI processing**
- Answer generation happens **asynchronously** (non-blocking)
- Users see "Generating answer..." immediately
- **Multiple questions can be processed simultaneously**

## Enhanced Features

### Question Detection Capabilities

#### Interrogative Patterns
- **Question words**: what, why, when, where, which, who, how
- **Modal questions**: can you, could you, would you, do you, did you
- **Existence queries**: is there, are there, will you, have you
- **Request phrases**: tell me, describe, explain, walk me through

#### Advanced Processing
- **Partial transcript buffering** - accumulates speech segments
- **Sentence boundary detection** - proper question extraction
- **Filler word removal** - cleans "um", "uh", "like" from questions
- **Confidence scoring** - uses AWS Transcribe confidence levels

### Duplicate Prevention
- **Similarity-based deduplication** - prevents near-duplicate questions
- **Time-based windows** - 30-second duplicate detection window
- **Question normalization** - standardized comparison format
- **Automatic cleanup** - removes old entries to prevent memory leaks

### Real-Time UI Enhancements
- **Confidence indicators** - visual confidence scores for transcripts
- **Partial transcript styling** - italicized real-time speech
- **Generation timing** - shows answer generation time
- **Urgency detection** - highlights urgent questions
- **Enhanced status indicators** - streaming/processing states

## Technical Implementation

### Audio Processing Pipeline
```
Audio Input → AWS Transcribe Streaming → Real-time Transcript → Question Detection → Answer Generation
     ↓                    ↓                      ↓                    ↓                ↓
System/Mic Audio     Partial + Final        Enhanced Parser     Async Processing   Immediate UI
```

### Question Detection Algorithm
1. **Partial Processing**: Buffer incomplete speech segments
2. **Final Processing**: Analyze complete transcript segments
3. **Pattern Matching**: Check for question indicators and sentence structure
4. **Validation**: Verify question quality and check for duplicates
5. **Extraction**: Clean and extract the complete question
6. **Categorization**: Classify as behavioral, coding, technical, or general

### Answer Generation Flow
```javascript
Question Detected → Immediate UI Update → Async Answer Generation → UI Update with Answer
      ↓                    ↓                        ↓                      ↓
   Event Emitted      "Generating..."        AWS Bedrock Call      Replace with Answer
```

## Configuration

### Environment Variables
```env
# Audio source mode
AUDIO_SOURCE_MODE=system  # microphone, system, both

# Transcribe settings
TRANSCRIBE_REGION=us-east-1
AWS_REGION=us-east-1

# Bedrock model for answers
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
```

### Question Detection Tuning
```javascript
// Cooldown between questions (ms)
questionCooldown: 3000

// Duplicate detection window (ms)  
duplicateWindow: 30000

// Minimum question length
minimumQuestionLength: 8
```

## Usage Examples

### Detecting Interview Questions
The system automatically detects various question types:

**Behavioral Questions:**
- "Tell me about a time you faced a challenge"
- "Describe a situation where you had to work with a difficult team member"

**Technical Questions:**
- "How would you design a scalable system?"
- "Explain the difference between REST and GraphQL"

**Coding Questions:**
- "Write a function to reverse a linked list"
- "How would you implement a binary search algorithm?"

### Real-Time Processing
1. **Speaker says**: "So, um, can you tell me about your experience with..."
2. **Partial transcript**: "So, um, can you tell me about your experience with" (italicized)
3. **Final transcript**: "So can you tell me about your experience with React?"
4. **Question detected**: ✅ Extracted: "Can you tell me about your experience with React?"
5. **Answer generated**: Immediate response about React experience

## API Enhancements

### New Event Types
```javascript
// Enhanced transcription events
'transcription-update': {
  text: "transcript content",
  isPartial: true,
  confidence: 0.95,
  timestamp: 1640995200000
}

// Enhanced question events  
'question-detected': {
  question: "What is your experience with React?",
  type: "technical", 
  urgency: false,
  confidence: 0.98,
  timestamp: 1640995200000,
  pending: true
}

// Enhanced answer events
'answer-generated': {
  question: "What is your experience with React?",
  type: "technical",
  answer: "I have 3 years of experience with React...",
  generationTime: 1250,
  timestamp: 1640995200000
}
```

## Performance Optimizations

### Streaming Efficiency
- **Chunked audio processing** - 32KB max chunks to AWS Transcribe
- **Async answer generation** - non-blocking question processing
- **Memory management** - automatic cleanup of old transcripts/questions
- **Error handling** - graceful fallbacks for network/API issues

### Response Times
- **Question detection**: < 100ms after final transcript
- **Answer generation**: 1-3 seconds (depends on question complexity)
- **UI updates**: Immediate for all events

## Troubleshooting

### Common Issues

**Questions not detected:**
- Check if audio input is working
- Verify AWS Transcribe is receiving audio
- Ensure questions contain recognizable patterns

**Duplicate questions:**
- Normal behavior - system prevents rapid duplicates
- Wait 3+ seconds between similar questions
- Rephrase if question is genuinely different

**Slow answer generation:**
- Check AWS Bedrock model availability
- Verify network connectivity
- Monitor AWS service limits

### Debug Information
Enable verbose logging by setting:
```env
NODE_ENV=development
```

The console will show:
- 🎯 Question detected events
- 🤖 Answer generation start
- ✅ Answer generation completion
- ❌ Error messages with details

## Security & Privacy

- **No audio storage** - audio is streamed directly to AWS Transcribe
- **Temporary transcripts** - cleaned up automatically
- **AWS encryption** - all data encrypted in transit and at rest
- **Local processing** - question detection happens locally
- **Configurable retention** - automatic cleanup of old data
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { TranscribeClient } = require('@aws-sdk/client-transcribe');
require('dotenv').config();

class AWSServices {
  constructor() {
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-sonnet-20240229-v1:0';
    this.inferenceProfileId = process.env.BEDROCK_INFERENCE_PROFILE_ID || '';
    this.resolvedModelId = this.resolveModelId();
    this.bedrock = new BedrockRuntimeClient({ 
      region: this.region
    });
    this.transcribe = new TranscribeClient({ 
      region: this.region
    });
  }

  async generateAnswer(question, questionType = 'general', options = {}) {
    const prompt = this.buildPrompt(question, questionType, options);
    
    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: questionType === 'coding' || questionType === 'debug' ? 1800 : 1000,
      messages: [{
        role: "user",
        content: prompt
      }],
      temperature: questionType === 'coding' || questionType === 'debug' ? 0.25 : 0.55
    });

    try {
      const command = new InvokeModelCommand({
        modelId: this.resolvedModelId,
        body: body,
        contentType: "application/json",
        accept: "application/json"
      });

      const response = await this.bedrock.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      return responseBody.content[0].text;
    } catch (error) {
      console.error('Bedrock error:', error);
      return [
        'Bedrock could not generate a response.',
        'Check AWS credentials, region, model access, and BEDROCK_MODEL_ID or BEDROCK_INFERENCE_PROFILE_ID in your environment.',
        `Region: ${this.region}`,
        `Configured model: ${this.modelId}`,
        `Invoked model/profile: ${this.resolvedModelId}`
      ].join('\n');
    }
  }

  resolveModelId() {
    if (this.inferenceProfileId) {
      return this.inferenceProfileId;
    }

    if (this.modelId.startsWith('arn:') || this.hasInferenceProfilePrefix(this.modelId)) {
      return this.modelId;
    }

    if (this.requiresInferenceProfile(this.modelId)) {
      return `${this.getInferenceProfilePrefix()}.${this.modelId}`;
    }

    return this.modelId;
  }

  hasInferenceProfilePrefix(modelId) {
    return /^(global|us|eu|au|jp)\./.test(modelId);
  }

  requiresInferenceProfile(modelId) {
    return [
      'anthropic.claude-haiku-4-5-20251001-v1:0',
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
      'anthropic.claude-opus-4-5-20251101-v1:0'
    ].includes(modelId);
  }

  getInferenceProfilePrefix() {
    if (this.region.startsWith('eu-')) return 'eu';
    if (this.region.startsWith('us-')) return 'us';
    if (this.region === 'ap-southeast-2') return 'au';
    if (this.region === 'ap-northeast-1') return 'jp';
    return 'global';
  }

  buildPrompt(question, questionType, options = {}) {
    const interviewContext = [
      'You are Interview Copilot AI, a concise real-time interview assistant.',
      'Give practical answers the candidate can speak naturally.',
      'Avoid claiming private experience unless the user provided it.',
      'When code is requested, prefer JavaScript unless another language is specified.',
      options.role ? `Target role: ${options.role}` : '',
      options.company ? `Company/context: ${options.company}` : ''
    ].filter(Boolean).join('\n');

    switch (questionType) {
      case 'behavioral':
        return `${interviewContext}

Answer this behavioral interview question using the STAR method.
Include:
1. A 20-second direct answer
2. STAR bullets with concrete but adaptable wording
3. A short closing line that ties the story to the role

Question: ${question}`;
        
      case 'coding':
        return `${interviewContext}

Solve this coding interview problem from transcript or screenshot OCR.
Return:
1. Clarifying assumptions
2. Optimal approach
3. Time and space complexity
4. Clean solution code
5. Dry run on one example
6. Edge cases to mention aloud

Problem:
${question}`;

      case 'debug':
        return `${interviewContext}

Debug the following code/problem. Return:
1. Most likely bug
2. Minimal fix
3. Corrected code if possible
4. How to explain the fix in an interview

Input:
${question}`;

      case 'technical':
        return `${interviewContext}

Answer this technical interview question with a senior, structured explanation.
Include the key concept, tradeoffs, pitfalls, and a concise example.

Question: ${question}`;
        
      default:
        return `${interviewContext}

Provide a clear, confident interview answer.
Keep it concise, structured, and easy to speak in 60-90 seconds.

Question: ${question}`;
    }
  }
}

module.exports = { AWSServices };

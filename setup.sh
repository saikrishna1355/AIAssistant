#!/bin/bash

echo "🦜 Setting up Interview Copilot AI..."

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Create .env file from example if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📄 Creating .env file..."
    cp .env.example .env
    echo "⚠️  Please configure your AWS credentials in .env file"
fi

# Create temp directory for screenshots
mkdir -p temp

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Configure AWS credentials in .env file"
echo "2. Run 'npm start' to launch the application"
echo ""
echo "AWS Services required:"
echo "- Bedrock (for AI responses)"
echo "- Transcribe (for speech-to-text)"
import React, { useState, useEffect } from 'react';
import { Settings, Zap, Brain, Clock, DollarSign } from 'lucide-react';

const LLMControls = () => {
  const [config, setConfig] = useState({
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    verificationMode: 'llm', // 'llm', 'regex', 'hybrid'
    batchSize: 5,
    delayMs: 1000,
    maxTokens: 300
  });

  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState({ cost: '$0.00', processed: 0, remaining: 0 });

  const providers = {
    anthropic: {
      name: 'Anthropic',
      models: [
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', cost: '$$$', speed: 'Fast' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', cost: '$$$$$', speed: 'Medium' }
      ]
    },
    openai: {
      name: 'OpenAI',
      models: [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', cost: '$$', speed: 'Fast' },
        { id: 'gpt-4o', name: 'GPT-4o', cost: '$$$$$', speed: 'Medium' }
      ]
    }
  };

  const verificationModes = {
    llm: {
      name: 'LLM Verification',
      description: 'Full AI analysis (most accurate)',
      icon: Brain,
      cost: 'High',
      accuracy: '95%'
    },
    regex: {
      name: 'Pattern Matching',
      description: 'Regex-based detection (fastest)',
      icon: Zap,
      cost: 'Free',
      accuracy: '75%'
    },
    hybrid: {
      name: 'Smart Hybrid',
      description: 'Regex first, LLM for edge cases',
      icon: Settings,
      cost: 'Low',
      accuracy: '90%'
    }
  };

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleProviderChange = (provider) => {
    const defaultModel = providers[provider].models[0].id;
    setConfig(prev => ({ 
      ...prev, 
      provider,
      model: defaultModel,
      batchSize: provider === 'openai' ? 2 : 5,
      delayMs: provider === 'openai' ? 2000 : 500
    }));
  };

  const startVerification = async () => {
    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          sourceSheetUrl: document.getElementById('sourceSheet').value,
          verifierSheetUrl: document.getElementById('verifierSheet').value
        })
      });
      
      const result = await response.json();
      if (result.success) {
        setStatus({
          cost: result.estimatedCost,
          processed: result.processed,
          remaining: result.remaining
        });
      }
    } catch (error) {
      console.error('Verification failed:', error);
    }
  };

  const estimateCost = () => {
    const { provider, model, verificationMode } = config;
    const urlCount = status.remaining || 100; // Default estimate
    
    if (verificationMode === 'regex') return '$0.00';
    
    const costPerUrl = {
      'claude-3-haiku-20240307': 0.002,
      'claude-3-5-sonnet-20241022': 0.008,
      'gpt-4o-mini': 0.003,
      'gpt-4o': 0.015
    };
    
    const baseCost = (costPerUrl[model] || 0.005) * urlCount;
    const hybridMultiplier = verificationMode === 'hybrid' ? 0.3 : 1;
    
    return `$${(baseCost * hybridMultiplier).toFixed(2)}`;
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Verification Settings</h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
        >
          <Settings size={16} />
          {isOpen ? 'Hide' : 'Configure'}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-6">
          {/* Verification Mode Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Verification Method
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(verificationModes).map(([key, mode]) => {
                const IconComponent = mode.icon;
                return (
                  <div
                    key={key}
                    onClick={() => handleConfigChange('verificationMode', key)}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      config.verificationMode === key
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <IconComponent size={20} className={config.verificationMode === key ? 'text-blue-600' : 'text-gray-600'} />
                      <span className="font-medium text-sm">{mode.name}</span>
                    </div>
                    <p className="text-xs text-gray-600 mb-2">{mode.description}</p>
                    <div className="flex justify-between text-xs">
                      <span className="text-green-600">Cost: {mode.cost}</span>
                      <span className="text-blue-600">Accuracy: {mode.accuracy}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* LLM Provider & Model (only show if LLM mode selected) */}
          {(config.verificationMode === 'llm' || config.verificationMode === 'hybrid') && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  LLM Provider
                </label>
                <select
                  value={config.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {Object.entries(providers).map(([key, provider]) => (
                    <option key={key} value={key}>{provider.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Model
                </label>
                <select
                  value={config.model}
                  onChange={(e) => handleConfigChange('model', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {providers[config.provider].models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.cost})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Advanced Settings */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Batch Size
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={config.batchSize}
                onChange={(e) => handleConfigChange('batchSize', parseInt(e.target.value))}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Delay (ms)
              </label>
              <input
                type="number"
                min="0"
                max="10000"
                step="500"
                value={config.delayMs}
                onChange={(e) => handleConfigChange('delayMs', parseInt(e.target.value))}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Tokens
              </label>
              <input
                type="number"
                min="100"
                max="2000"
                step="100"
                value={config.maxTokens}
                onChange={(e) => handleConfigChange('maxTokens', parseInt(e.target.value))}
                className="w-full p-2 border border-gray-300 rounded-md text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Est. Cost
              </label>
              <div className="flex items-center gap-1 p-2 bg-gray-50 rounded-md text-sm font-medium">
                <DollarSign size={14} />
                {estimateCost()}
              </div>
            </div>
          </div>

          {/* Status Display */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <Clock size={16} className="text-blue-600" />
                <span>Processed: {status.processed}</span>
              </div>
              <div className="flex items-center gap-1">
                <DollarSign size={16} className="text-green-600" />
                <span>Cost: {status.cost}</span>
              </div>
              {status.remaining > 0 && (
                <div className="text-orange-600">
                  Remaining: {status.remaining}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Start Button */}
      <div className="mt-4">
        <button
          onClick={startVerification}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <Brain size={20} />
          Start Verification ({config.verificationMode === 'regex' ? 'Pattern Match' : 
                             config.verificationMode === 'hybrid' ? 'Smart Hybrid' : 
                             `${providers[config.provider].name} ${config.model.split('-').pop()}`})
        </button>
      </div>
    </div>
  );
};

export default LLMControls;
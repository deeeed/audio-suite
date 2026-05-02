'use strict';

module.exports = {
  'sherpa.agentic_ready': {
    description: 'The sherpa-voice app is running with the agentic bridge installed.',
    async: false,
    expression: 'JSON.stringify(globalThis.__AGENTIC__?.getRoute() || null)',
    assert: { operator: 'not_null', field: 'pathname' },
    hint: 'Start sherpa-voice in dev mode and ensure the bridge is active.',
    fixtures: {
      pass: '{"pathname":"/features/asr","segments":["(tabs)","features","asr"]}',
      fail: 'null',
    },
  },
  'sherpa.asr_screen_visible': {
    description: 'The ASR feature screen is mounted and exposes its primary controls by testID.',
    async: false,
    expression: "JSON.stringify((function(){ return { initVisible: !!globalThis.__AGENTIC__?.findFiberByTestId?.('btn-init-asr'), recognizeVisible: !!globalThis.__AGENTIC__?.findFiberByTestId?.('btn-recognize') }; })())",
    assert: { operator: 'eq', field: 'initVisible', value: true },
    hint: 'Navigate to /features/asr before running ASR smoke flows.',
    fixtures: {
      pass: '{"initVisible":true,"recognizeVisible":true}',
      fail: '{"initVisible":false,"recognizeVisible":false}',
    },
  },
};

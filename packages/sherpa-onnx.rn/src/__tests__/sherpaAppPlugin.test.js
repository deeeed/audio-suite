const { removeLegacyOrtPickFirst } = require('../../app.plugin');

describe('Sherpa Expo config plugin', () => {
  it('removes the obsolete ONNX Runtime pickFirst rule', () => {
    const properties = [
      {
        type: 'property',
        key: 'android.packagingOptions.pickFirsts',
        value: '**/libc++_shared.so,**/libonnxruntime.so',
      },
    ];

    expect(removeLegacyOrtPickFirst(properties)).toEqual([
      {
        type: 'property',
        key: 'android.packagingOptions.pickFirsts',
        value: '**/libc++_shared.so',
      },
    ]);
  });

  it('removes the property when ONNX Runtime is its only value', () => {
    const properties = [
      {
        type: 'property',
        key: 'android.packagingOptions.pickFirsts',
        value: '**/libonnxruntime.so',
      },
    ];

    expect(removeLegacyOrtPickFirst(properties)).toEqual([]);
  });
});

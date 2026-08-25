const { createRunOncePlugin, withGradleProperties } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-siteed-sherpa-onnx-rn';
const PICK_FIRST_PATTERN = '**/libonnxruntime.so';

function removeLegacyOrtPickFirst(properties) {
  const existing = properties.find(
    (item) => item.type === 'property' && item.key === 'android.packagingOptions.pickFirsts'
  );
  if (!existing) return properties;

  const values = String(existing.value || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && value !== PICK_FIRST_PATTERN);

  if (values.length === 0) {
    return properties.filter((item) => item !== existing);
  }
  existing.value = values.join(',');
  return properties;
}

function withSherpaOnnxAndroidPackaging(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = removeLegacyOrtPickFirst(config.modResults);
    return config;
  });
}

const plugin = createRunOncePlugin(
  withSherpaOnnxAndroidPackaging,
  PLUGIN_NAME,
  require('./package.json').version
);

module.exports = plugin;
module.exports.removeLegacyOrtPickFirst = removeLegacyOrtPickFirst;
